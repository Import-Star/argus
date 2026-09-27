import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type SessionState = "idle" | "working" | "permission" | "question" | "done" | "ended";

interface SessionRecord {
  sessionId: string;
  cwd: string;
  transcriptPath?: string;
  startedAt: number;
  updatedAt: number;
  stateSince: number;
  state: SessionState;
  title?: string;
  lastPrompt?: string;
  pending?: string;
  lastMessage?: string;
  prs: string[];
  worktrees?: string[];
  links?: Record<string, string>;
  lastTool?: string;
  endReason?: string;
}

interface HookInput {
  session_id: string;
  hook_event_name: string;
  cwd?: string;
  transcript_path?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: { stdout?: string };
  notification_type?: string;
  last_assistant_message?: string;
  reason?: string;
  agent_id?: string;
}

const DIR = path.join(os.homedir(), ".claude", "argus", "sessions");
const CONFIG_FILE = path.join(os.homedir(), ".claude", "argus", "config.json");

// A session's first prompt may carry `[argus:<plugin>:<id>]` markers (sessions.start({ link })). Plugin ids are
// `[a-z0-9-]+`, item ids `[A-Za-z0-9_.-]+`. The legacy `[argus-card:<id>]` marker maps to `links.kanban`.
const MARKER_RE = /\[argus:([a-z0-9-]+):([A-Za-z0-9_.-]+)\]/g;
const LEGACY_CARD_MARKER = /\[argus-card:([A-Za-z0-9_]+)\]/g;
const SESSION_ID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const DEFAULT_TITLE_NUDGE =
  "Argus: once the task is clear, give this session a short title (under 60 chars) with the argus-rename-session skill. Session id: {sessionId}. If you create or move into a git worktree, link it with the same skill.";

// Fed to the agent on a session's first prompt so it names the session. {"titleNudge": "text"} in
// ~/.claude/argus/config.json replaces the text (supports a {sessionId} placeholder); "" or false turns it off.
function titleNudge(sessionId: string): string | undefined {
  const template = ((): string | undefined => {
    try {
      const value = (JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as { titleNudge?: unknown }).titleNudge;
      if (value === undefined) {
        return DEFAULT_TITLE_NUDGE;
      }
      if (value === false) {
        return undefined;
      }
      if (typeof value === "string") {
        return value.trim() ? value : undefined;
      }
      return DEFAULT_TITLE_NUDGE;
    } catch {
      return DEFAULT_TITLE_NUDGE;
    }
  })();
  return template?.replace(/\{sessionId\}/g, sessionId);
}
const PR_URL = /https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/g;

function readStdin(): string {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function load(sessionId: string): SessionRecord | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, `${sessionId}.json`), "utf8")) as SessionRecord;
  } catch {
    return undefined;
  }
}

function save(record: SessionRecord): void {
  fs.mkdirSync(DIR, { recursive: true });
  const target = path.join(DIR, `${record.sessionId}.json`);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2));
  // On Windows the rename fails while another process (the extension, a parallel hook) has the target open.
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, target);
      return;
    } catch (error) {
      if (attempt >= 20) {
        fs.rmSync(tmp, { force: true });
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function stripIdeTags(text: string): string {
  return text.replace(/<ide_[a-z_]+>[\s\S]*?<\/ide_[a-z_]+>/g, "").trim();
}

// Linked worktree root for a folder, or undefined when the folder is a main checkout or not in git.
function worktreeRoot(dir: string): string | undefined {
  try {
    const out = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel", "--git-dir", "--git-common-dir"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"]
    });
    const [top, gitDir, commonDir] = out.trim().split("\n");
    return path.resolve(dir, gitDir) === path.resolve(dir, commonDir) ? undefined : top;
  } catch {
    return undefined;
  }
}

function linkWorktree(record: SessionRecord, dir: string | undefined): void {
  const root = dir ? worktreeRoot(dir) : undefined;
  if (root && !(record.worktrees ?? []).includes(root)) {
    record.worktrees = [...(record.worktrees ?? []), root];
  }
}

function worktreeAddPath(command: string, cwd: string): string | undefined {
  const match = command.match(/\bgit\s+(?:-C\s+(\S+)\s+)?worktree\s+add\s+(?:-{1,2}\S+\s+(?:\S+\s+)?)*?([^\s-][^\s;&|]*)/);
  if (!match) {
    return undefined;
  }
  return path.resolve(match[1] ? path.resolve(cwd, match[1]) : cwd, match[2].replace(/^["']|["']$/g, ""));
}

function toolSummary(name: string, input: Record<string, unknown> | undefined): string {
  const value = input?.command ?? input?.file_path ?? input?.url ?? input?.pattern ?? input?.skill ?? "";
  return clip(`${name} ${String(value)}`, 140);
}

function toolCall(name: string, input: Record<string, unknown> | undefined, cwd: string): string {
  const raw = String(input?.file_path ?? input?.command ?? input?.pattern ?? input?.url ?? input?.skill ?? input?.description ?? "");
  const arg = raw.startsWith(`${cwd}/`) ? raw.slice(cwd.length + 1) : raw;
  return clip(arg ? `${name}(${arg})` : name, 120);
}

function questionSummary(input: Record<string, unknown> | undefined): string {
  const questions = input?.questions;
  if (Array.isArray(questions) && questions.length > 0) {
    const first = questions[0] as { question?: string };
    return clip(first.question ?? "Question", 200);
  }
  return "Question";
}

function collectPrs(record: SessionRecord, ...sources: unknown[]): void {
  for (const source of sources) {
    const text = typeof source === "string" ? source : JSON.stringify(source ?? "");
    for (const url of text.match(PR_URL) ?? []) {
      if (!record.prs.includes(url)) {
        record.prs.push(url);
      }
    }
  }
}

function setState(record: SessionRecord, state: SessionState, now: number): void {
  if (record.state !== state) {
    record.stateSince = now;
  }
  record.state = state;
}

// Extracts every `[argus:<plugin>:<id>]` / legacy `[argus-card:<id>]` marker from a prompt, returning the
// markers stripped out and the links they carry.
function extractLinks(raw: string): { prompt: string; links: Record<string, string> } {
  const links: Record<string, string> = {};
  for (const match of raw.matchAll(MARKER_RE)) {
    links[match[1]] = match[2];
  }
  for (const match of raw.matchAll(LEGACY_CARD_MARKER)) {
    links.kanban = match[1];
  }
  const prompt = raw.replace(MARKER_RE, "").replace(LEGACY_CARD_MARKER, "").trim();
  return { prompt, links };
}

function apply(record: SessionRecord, input: HookInput, now: number): void {
  switch (input.hook_event_name) {
    case "SessionStart":
      setState(record, "idle", now);
      record.pending = undefined;
      return;
    case "UserPromptSubmit": {
      const raw = stripIdeTags(input.prompt ?? "");
      const { prompt, links } = extractLinks(raw);
      if (Object.keys(links).length > 0) {
        record.links = { ...(record.links ?? {}), ...links };
      }
      if (prompt) {
        record.lastPrompt = clip(prompt, 200);
        if (!record.title) {
          record.title = clip(prompt, 120);
          // UserPromptSubmit stdout is shown to the agent as context.
          const nudge = titleNudge(record.sessionId);
          if (nudge) {
            process.stdout.write(`${nudge}\n`);
          }
        }
      }
      record.pending = undefined;
      setState(record, "working", now);
      return;
    }
    case "PreToolUse":
      if (input.tool_name === "AskUserQuestion") {
        record.pending = questionSummary(input.tool_input);
        setState(record, "question", now);
        return;
      }
      record.pending = undefined;
      record.lastTool = toolCall(input.tool_name ?? "tool", input.tool_input, input.cwd ?? record.cwd);
      setState(record, "working", now);
      return;
    case "PermissionRequest":
      record.pending = toolSummary(input.tool_name ?? "tool", input.tool_input);
      setState(record, "permission", now);
      return;
    case "Notification":
      if (input.notification_type === "permission_prompt" && record.state !== "permission") {
        setState(record, "permission", now);
      }
      return;
    case "PostToolUse": {
      record.pending = undefined;
      setState(record, "working", now);
      const command = String(input.tool_input?.command ?? "");
      if (input.tool_name === "Bash" && /\bgh\s+pr\s+create\b/.test(command)) {
        collectPrs(record, input.tool_response?.stdout ?? "");
      }
      linkWorktree(record, input.cwd);
      const added = worktreeAddPath(command, input.cwd ?? record.cwd);
      if (added) {
        linkWorktree(record, added);
      }
      return;
    }
    case "Stop":
      record.pending = undefined;
      record.lastTool = undefined;
      if (input.last_assistant_message) {
        record.lastMessage = clip(input.last_assistant_message, 300);
        collectPrs(record, input.last_assistant_message);
      }
      setState(record, "done", now);
      return;
    case "SessionEnd":
      record.endReason = input.reason;
      setState(record, "ended", now);
      return;
    default:
      return;
  }
}

// A sub-agent running a tool means the permission prompt the main agent was blocked on (typically the Agent tool
// itself) has been answered. Nothing else reports that, so the card would sit in "needs you" while sub-agents work.
function clearPermissionFromSubAgent(input: HookInput): void {
  if (input.hook_event_name !== "PreToolUse" && input.hook_event_name !== "PostToolUse") {
    return;
  }
  const record = load(input.session_id);
  if (!record || record.state !== "permission") {
    return;
  }
  const now = Date.now();
  record.pending = undefined;
  setState(record, "working", now);
  record.updatedAt = now;
  save(record);
}

function hookMain(): void {
  const raw = readStdin();
  if (!raw.trim()) {
    return;
  }
  const input = JSON.parse(raw) as HookInput;
  if (!input.session_id) {
    return;
  }
  if (input.agent_id) {
    clearPermissionFromSubAgent(input);
    return;
  }

  const now = Date.now();
  const record: SessionRecord = load(input.session_id) ?? {
    sessionId: input.session_id,
    cwd: input.cwd ?? process.cwd(),
    startedAt: now,
    updatedAt: now,
    stateSince: now,
    state: "idle",
    prs: []
  };

  if (input.cwd && input.hook_event_name === "SessionStart") {
    record.cwd = input.cwd;
  }
  if (input.transcript_path) {
    record.transcriptPath = input.transcript_path;
  }

  apply(record, input, now);
  record.updatedAt = now;
  save(record);
}

// --- CLI mode: `node session-tracker.ts set [--session <id>] [--title <text>] [--worktree <path>]...` ---
// Lets the argus-rename-session skill update a session's record without its own script.

function isAncestorOrSame(ancestor: string, dir: string): boolean {
  const rel = path.relative(ancestor, dir);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// Picks the session a CLI invocation without --session most likely refers to: the record in state "working"
// updated most recently within the last 2 minutes, preferring one whose cwd is (or is an ancestor of) ours.
// The PreToolUse hook has just bumped that session, because the agent is running this command through a tool.
function guessSessionId(): string | undefined {
  const cwd = process.cwd();
  const cutoff = Date.now() - 2 * 60 * 1000;
  let files: string[];
  try {
    files = fs.readdirSync(DIR);
  } catch {
    return undefined;
  }
  let best: SessionRecord | undefined;
  let bestMatchesCwd = false;
  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue;
    }
    let record: SessionRecord | undefined;
    try {
      record = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")) as SessionRecord;
    } catch {
      continue;
    }
    if (record.state !== "working" || record.updatedAt < cutoff) {
      continue;
    }
    const matchesCwd = isAncestorOrSame(record.cwd, cwd);
    if (!best || (matchesCwd && !bestMatchesCwd) || (matchesCwd === bestMatchesCwd && record.updatedAt > best.updatedAt)) {
      best = record;
      bestMatchesCwd = matchesCwd;
    }
  }
  return best?.sessionId;
}

class UsageError extends Error {}

function cli(argv: string[]): void {
  const args = argv.slice(3);
  let sessionId: string | undefined;
  let title: string | undefined;
  const worktrees: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--session") {
      sessionId = args[++i];
    } else if (arg === "--title") {
      title = args[++i];
    } else if (arg === "--worktree") {
      const value = args[++i];
      if (value === undefined) {
        throw new UsageError("--worktree needs a path");
      }
      worktrees.push(value);
    } else {
      throw new UsageError(`unknown argument: ${arg}`);
    }
  }

  if (title === undefined && worktrees.length === 0) {
    throw new UsageError("nothing to do: pass --title and/or --worktree");
  }

  const resolvedId = (sessionId && sessionId.trim()) || guessSessionId();
  if (!resolvedId) {
    throw new UsageError("no --session given and no recently active session was found");
  }
  if (!SESSION_ID_RE.test(resolvedId)) {
    throw new UsageError(`not a valid session id: ${resolvedId}`);
  }
  const record = load(resolvedId);
  if (!record) {
    throw new UsageError(`no session record for ${resolvedId}`);
  }

  const notes: string[] = [];
  if (title !== undefined) {
    const trimmed = title.trim().slice(0, 120);
    record.title = trimmed;
    notes.push(`title set to "${trimmed}"`);
  }
  for (const worktree of worktrees) {
    const dir = path.resolve(process.cwd(), worktree);
    const root = worktreeRoot(dir);
    if (root) {
      linkWorktree(record, dir);
      notes.push(`linked worktree ${root}`);
    } else {
      notes.push(`${dir} is not a linked git worktree`);
    }
  }

  record.updatedAt = Date.now();
  save(record);
  console.log(`Argus: ${notes.join("; ")} (session ${resolvedId}).`);
}

function main(): void {
  if (process.argv[2] === "set") {
    try {
      cli(process.argv);
    } catch (error) {
      process.stderr.write(`Argus: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }
  // Every other invocation is a Claude Code hook: it must never throw or print unexpected output, since stdout
  // is shown to the agent as context and a thrown error would break the event that invoked it.
  try {
    hookMain();
  } catch {
    // ignore
  }
}

main();
