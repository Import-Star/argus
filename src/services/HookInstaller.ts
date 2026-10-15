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
  fs.mkdirSync(ARGUS_DIR, { recursive: true });
  fs.copyFileSync(path.join(extensionPath, "hooks", SCRIPT), INSTALLED_SCRIPT);
  // An earlier build ran a compiled copy of the script; drop it.
  fs.rmSync(path.join(ARGUS_DIR, "session-tracker.js"), { force: true });
  // Marks the hook as an ES module so Node skips the slow "detect module syntax" reparse and its warning.
  fs.writeFileSync(path.join(ARGUS_DIR, "package.json"), `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`);
  // Node 24+ runs TypeScript natively, so the hook ships as source.
  return `"${findNode() ?? "node"}" --no-warnings "${INSTALLED_SCRIPT}"`;
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
