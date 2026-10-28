import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const SETTINGS = path.join(CLAUDE_DIR, "settings.json");
const SCRIPT = "session-tracker.ts";
const ARGUS_DIR = path.join(CLAUDE_DIR, "argus");
const INSTALLED_SCRIPT = path.join(ARGUS_DIR, SCRIPT);
const SKILL_NAME = "argus-rename-session";
const SKILL_DIR = path.join(CLAUDE_DIR, "skills", SKILL_NAME);
const SKILL_FILE = path.join(SKILL_DIR, "SKILL.md");
const LINK_SKILL_NAME = "argus-link-prs";
const LINK_SKILL_DIR = path.join(CLAUDE_DIR, "skills", LINK_SKILL_NAME);

interface HookEntry {
  matcher?: string;
  hooks: Array<{ type: "command"; command: string; timeout?: number }>;
}

const EVENTS: Array<{ event: string; matcher?: string }> = [
  { event: "SessionStart" },
  { event: "UserPromptSubmit" },
  { event: "PreToolUse" },
  { event: "PostToolUse", matcher: "Bash" },
  { event: "PermissionRequest" },
  { event: "Notification" },
  { event: "Stop" },
  { event: "SubagentStart" },
  { event: "SubagentStop" },
  { event: "SessionEnd" }
];

// Recognises a hook command line as ours, regardless of platform path separators or quoting.
function isArgusCommand(command: string): boolean {
  const normalized = command.toLowerCase().replace(/\\/g, "/");
  return normalized.includes("argus") && normalized.includes("session-tracker");
}

// VS Code started from the Dock doesn't get the shell PATH, so nvm and Homebrew installs aren't found by name.
function nodeCandidates(): string[] {
  const nvmDirs = [process.env.NVM_DIR, path.join(os.homedir(), ".nvm"), "/opt/homebrew/opt/nvm", "/usr/local/opt/nvm"];
  const nvmNodes = nvmDirs.flatMap((dir) => {
    const versions = dir ? path.join(dir, "versions", "node") : "";
    if (!versions || !fs.existsSync(versions)) {
      return [];
    }
    return fs
      .readdirSync(versions)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((version) => path.join(versions, version, "bin", "node"));
  });
  return ["node", "/opt/homebrew/bin/node", "/usr/local/bin/node", ...nvmNodes];
}

function nodeVersion(candidate: string): number | undefined {
  try {
    return Number.parseInt(execFileSync(candidate, ["--version"], { encoding: "utf8", timeout: 5000 }).trim().replace(/^v/, ""), 10);
  } catch {
    return undefined;
  }
}

// Full path, so hooks work whatever PATH Claude Code is started with.
export function findNode(): string | undefined {
  for (const candidate of nodeCandidates()) {
    if ((nodeVersion(candidate) ?? 0) >= 24) {
      return candidate === "node" ? execFileSync("node", ["-p", "process.execPath"], { encoding: "utf8" }).trim() : candidate;
    }
  }
  return fromLoginShell();
}

// Last resort: the user's own shell knows about fnm, volta, asdf, mise and the rest.
function fromLoginShell(): string | undefined {
  if (process.platform === "win32" || !process.env.SHELL) {
    return undefined;
  }
  try {
    const found = execFileSync(process.env.SHELL, ["-ilc", "command -v node"], { encoding: "utf8", timeout: 10000 }).trim().split("\n").pop();
    return found && (nodeVersion(found) ?? 0) >= 24 ? found : undefined;
  } catch {
    return undefined;
  }
}

// Copied out of the extension folder so version bumps don't break the path in settings.json.
function installScript(extensionPath: string): string {
  copyScript(path.join(extensionPath, "hooks", SCRIPT), ARGUS_DIR, extensionVersion(extensionPath));
  // Node 24+ runs TypeScript natively, so the hook ships as source.
  return `"${findNode() ?? "node"}" --no-warnings "${INSTALLED_SCRIPT}"`;
}

function extensionVersion(extensionPath: string): string {
  try {
    return String((JSON.parse(fs.readFileSync(path.join(extensionPath, "package.json"), "utf8")) as { version?: unknown }).version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
}

// Writes through a temp file so a hook running at that moment never reads half a script.
function copyScript(source: string, dir: string, version: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, SCRIPT);
  const temp = `${target}.${process.pid}.tmp`;
  fs.copyFileSync(source, temp);
  fs.renameSync(temp, target);
  // An earlier build ran a compiled copy of the script; drop it.
  fs.rmSync(path.join(dir, "session-tracker.js"), { force: true });
  // Marks the hook as an ES module so Node skips the slow "detect module syntax" reparse and its warning. The version
  // stops an older Argus (in another VS Code install, say) from replacing a newer script.
  fs.writeFileSync(path.join(dir, "package.json"), `${JSON.stringify({ private: true, type: "module", version }, null, 2)}\n`);
}

function newerVersion(a: string, b: string): boolean {
  const parts = (version: string) => version.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let at = 0; at < Math.max(x.length, y.length); at += 1) {
    if ((x[at] ?? 0) !== (y[at] ?? 0)) {
      return (x[at] ?? 0) > (y[at] ?? 0);
    }
  }
  return false;
}

// Brings the installed hook script in line with this build without touching settings.json. "newer" means a newer
// Argus installed it, which this build leaves alone.
export function refreshHookScript(source: string, dir: string, version: string): "updated" | "current" | "newer" {
  try {
    if (fs.readFileSync(path.join(dir, SCRIPT), "utf8") === fs.readFileSync(source, "utf8")) {
      return "current";
    }
  } catch {
    // A missing installed script is just out of date.
  }
  let installed = "0.0.0";
  try {
    installed = String((JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { version?: unknown }).version ?? "0.0.0");
  } catch {
    // Scripts from before the version marker count as oldest.
  }
  if (newerVersion(installed, version)) {
    return "newer";
  }
  copyScript(source, dir, version);
  return "updated";
}

export type TrackingProblem = "off" | "partial" | "node-missing";

// What, if anything, needs the user to run Set Up Session Tracking. A stale script doesn't: Argus replaces it.
export function trackingProblem(settings: { hooks?: Record<string, HookEntry[]> }, exists: (file: string) => boolean = fs.existsSync): TrackingProblem | undefined {
  const hooked = hookedEvents(settings).length;
  if (hooked === 0) {
    return "off";
  }
  if (hooked < EVENTS.length) {
    return "partial";
  }
  return hookNodes(settings).some((node) => path.isAbsolute(node) && !exists(node)) ? "node-missing" : undefined;
}

// The Node executables our hook commands run, from their leading (quoted) word.
function hookNodes(settings: { hooks?: Record<string, HookEntry[]> }): string[] {
  const commands = Object.values(settings.hooks ?? {})
    .flat()
    .flatMap((entry) => entry.hooks ?? [])
    .map((hook) => hook.command)
    .filter((command): command is string => typeof command === "string" && isArgusCommand(command));
  return [...new Set(commands.map((command) => /^"([^"]+)"/.exec(command)?.[1] ?? command.split(" ")[0]))];
}

export function readClaudeSettings(): { hooks?: Record<string, HookEntry[]> } {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
  } catch {
    // Missing or unreadable settings: nothing is hooked.
    return {};
  }
}

// On startup and when the window regains focus: replaces a stale hook script, then reports what's left to do.
export function checkTracking(extensionPath: string): { problem?: TrackingProblem; scriptUpdated: boolean } {
  const problem = trackingProblem(readClaudeSettings());
  if (problem === "off") {
    return { problem, scriptUpdated: false };
  }
  let scriptUpdated = false;
  try {
    scriptUpdated = refreshHookScript(path.join(extensionPath, "hooks", SCRIPT), ARGUS_DIR, extensionVersion(extensionPath)) === "updated";
  } catch {
    // ~/.claude/argus isn't writable: Set Up Session Tracking reports why.
  }
  return { problem, scriptUpdated };
}

// Writes the argus-link-prs skill into ~/.claude/skills, with {{SCRIPT}} replaced by the command that runs the
// installed hook script.
function installLinkSkill(extensionPath: string): void {
  const template = fs.readFileSync(path.join(extensionPath, "skills", LINK_SKILL_NAME, "SKILL.md"), "utf8");
  fs.mkdirSync(LINK_SKILL_DIR, { recursive: true });
  fs.writeFileSync(path.join(LINK_SKILL_DIR, "SKILL.md"), template.split("{{SCRIPT}}").join(`"${findNode() ?? "node"}" "${INSTALLED_SCRIPT}"`));
}

export function installHooks(extensionPath: string): { added: number; updated: number; settingsPath: string } {
  const exists = fs.existsSync(SETTINGS);
  const settings = (exists ? JSON.parse(fs.readFileSync(SETTINGS, "utf8")) : {}) as { hooks?: Record<string, HookEntry[]> };
  settings.hooks ??= {};
  const command = installScript(extensionPath);
  let added = 0;
  let updated = 0;

  for (const { event, matcher } of EVENTS) {
    const entries = (settings.hooks[event] ??= []);
    const existing = entries.find((entry) => entry.hooks.some((hook) => isArgusCommand(hook.command)));
    if (existing) {
      if (matcher) {
        existing.matcher = matcher;
      } else {
        delete existing.matcher;
      }
      if (existing.hooks.some((hook) => isArgusCommand(hook.command) && hook.command !== command)) {
        updated += 1;
      }
      existing.hooks = existing.hooks.map((hook) => (isArgusCommand(hook.command) ? { ...hook, command } : hook));
      continue;
    }
    entries.push({ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command, timeout: 10 }] });
    added += 1;
  }

  if (exists) {
    fs.copyFileSync(SETTINGS, `${SETTINGS}.bak`);
  }
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, `${JSON.stringify(settings, null, 2)}\n`);

  // Earlier versions installed a skill for agents to title sessions; titles now come from Claude Code's /rename.
  removeSkill();
  installLinkSkill(extensionPath);

  return { added, updated, settingsPath: SETTINGS };
}

// Deletes ~/.claude/skills/argus-rename-session only when its frontmatter names our skill (so we never delete a
// folder of the same name the user repurposed).
function removeSkill(): boolean {
  try {
    if (!/^name:\s*argus-rename-session\s*$/m.test(fs.readFileSync(SKILL_FILE, "utf8"))) {
      return false;
    }
  } catch {
    return false;
  }
  fs.rmSync(SKILL_DIR, { recursive: true, force: true });
  return true;
}

export function removeHooks(): { removed: number; settingsPath: string; skillRemoved: boolean } {
  let removed = 0;
  if (fs.existsSync(SETTINGS)) {
    const settings = JSON.parse(fs.readFileSync(SETTINGS, "utf8")) as { hooks?: Record<string, HookEntry[]> };
    if (settings.hooks) {
      for (const event of Object.keys(settings.hooks)) {
        const entries = settings.hooks[event];
        const kept: HookEntry[] = [];
        for (const entry of entries) {
          const ownHooks = entry.hooks.filter((hook) => isArgusCommand(hook.command));
          removed += ownHooks.length;
          const remainingHooks = entry.hooks.filter((hook) => !isArgusCommand(hook.command));
          if (remainingHooks.length > 0) {
            kept.push({ ...entry, hooks: remainingHooks });
          }
        }
        if (kept.length > 0) {
          settings.hooks[event] = kept;
        } else {
          delete settings.hooks[event];
        }
      }
    }

    if (removed > 0) {
      fs.copyFileSync(SETTINGS, `${SETTINGS}.bak`);
      fs.writeFileSync(SETTINGS, `${JSON.stringify(settings, null, 2)}\n`);
    }
  }

  const skillRemoved = removeSkill();

  // Keep sessions/, board.json and config.json; only the hook script and its module marker are ours to remove.
  fs.rmSync(LINK_SKILL_DIR, { recursive: true, force: true });
  fs.rmSync(INSTALLED_SCRIPT, { force: true });
  fs.rmSync(path.join(ARGUS_DIR, "package.json"), { force: true });

  return { removed, settingsPath: SETTINGS, skillRemoved };
}

export interface TrackingStatus {
  // Events from EVENTS that have an Argus hook in ~/.claude/settings.json.
  hooked: number;
  events: number;
  // The installed hook script matches the one this build ships.
  scriptCurrent: boolean;
  node?: string;
  settingsPath: string;
}

// Which of our events have an Argus hook in a parsed settings.json.
export function hookedEvents(settings: { hooks?: Record<string, HookEntry[]> }): string[] {
  return EVENTS.map(({ event }) => event).filter((event) =>
    (settings.hooks?.[event] ?? []).some((entry) => entry.hooks?.some((hook) => typeof hook.command === "string" && isArgusCommand(hook.command)))
  );
}

export function trackingStatus(extensionPath: string): TrackingStatus {
  const settings = readClaudeSettings();
  let scriptCurrent = false;
  try {
    scriptCurrent = fs.readFileSync(INSTALLED_SCRIPT, "utf8") === fs.readFileSync(path.join(extensionPath, "hooks", SCRIPT), "utf8");
  } catch {
    scriptCurrent = false;
  }
  return { hooked: hookedEvents(settings).length, events: EVENTS.length, scriptCurrent, node: findNode(), settingsPath: SETTINGS };
}
