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
  lastMessageAt?: number;
  state: SessionState;
  title?: string;
  titleSource?: "user";
  lastPrompt?: string;
  pending?: string;
  lastMessage?: string;
  prs: string[];
  worktrees?: string[];
  links?: Record<string, string>;
  lastTool?: string;
  endReason?: string;
  subagents?: Record<string, string>;
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
  source?: string;
  agent_id?: string;
  agent_type?: string;
}

const DIR = path.join(os.homedir(), ".claude", "argus", "sessions");

// A session's first prompt may carry `[argus:<plugin>:<id>]` markers (sessions.start({ link })). Plugin ids are
// `[a-z0-9-]+`, item ids `[A-Za-z0-9_.-]+`. The legacy `[argus-card:<id>]` marker maps to `links.kanban`.
const MARKER_RE = /\[argus:([a-z0-9-]+):([A-Za-z0-9_.-]+)\]/g;
const LEGACY_CARD_MARKER = /\[argus-card:([A-Za-z0-9_]+)\]/g;

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

// Claude Code appends an `ai-title` line to the transcript every turn, so the tail always holds the latest one.
function aiTitle(transcriptPath: string | undefined): string | undefined {
  if (!transcriptPath) {
    return undefined;
  }
  try {
    const fd = fs.openSync(transcriptPath, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const length = Math.min(size, 1_048_576);
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, size - length);
      const matches = [...buffer.toString("utf8").matchAll(/"type":"ai-title","aiTitle":("(?:[^"\\]|\\.)*")/g)];
      const last = matches.at(-1);
      return last ? clip(JSON.parse(last[1]) as string, 120) : undefined;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;
  }
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
      // Background agents keep running through a compaction, but not across a restart or resume.
      if (input.source !== "compact") {
        record.subagents = undefined;
      }
      return;
    case "UserPromptSubmit": {
      const raw = stripIdeTags(input.prompt ?? "");
      const { prompt, links } = extractLinks(raw);
      if (Object.keys(links).length > 0) {
        record.links = { ...(record.links ?? {}), ...links };
      }
      if (prompt) {
        record.lastPrompt = clip(prompt, 200);
        record.title ??= clip(prompt, 120);
      }
      record.pending = undefined;
      record.lastMessageAt = now;
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
      }
      record.lastMessageAt = now;
      if (record.titleSource !== "user") {
        record.title = aiTitle(input.transcript_path ?? record.transcriptPath) ?? record.title;
      }
      setState(record, "done", now);
      return;
    case "SessionEnd":
      record.endReason = input.reason;
      record.subagents = undefined;
      // Keep "working" so the board can show a session closed mid-turn as interrupted.
      if (record.state !== "working") {
        setState(record, "ended", now);
      }
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

function trackSubAgent(input: HookInput): void {
  const record = load(input.session_id);
  if (!record || !input.agent_id) {
    return;
  }
  const subagents = { ...(record.subagents ?? {}) };
  if (input.hook_event_name === "SubagentStart") {
    subagents[input.agent_id] = input.agent_type || "agent";
  } else {
    delete subagents[input.agent_id];
  }
  record.subagents = Object.keys(subagents).length > 0 ? subagents : undefined;
  record.updatedAt = Date.now();
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
  if (input.hook_event_name === "SubagentStart" || input.hook_event_name === "SubagentStop") {
    trackSubAgent(input);
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

// The session a `set` call without --session means: the only one in state "working", which the PreToolUse hook has
// just bumped because the agent is running this command.
function workingSessionId(): string | undefined {
  const working = fs
    .readdirSync(DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => load(file.slice(0, -5)))
    .filter((record): record is SessionRecord => record?.state === "working" && Date.now() - record.updatedAt < 120_000);
  if (working.length > 1) {
    throw new Error(`${working.length} sessions are working, pass --session: ${working.map((r) => `${r.sessionId} (${r.title ?? ""})`).join(", ")}`);
  }
  return working[0]?.sessionId;
}

const PR_ARG = /^https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+$/;

// `node session-tracker.ts set [--session <id>] --pr <url>...` links PRs the hooks missed (e.g. a script ran gh pr create).
function setPrs(args: string[]): void {
  let sessionId: string | undefined;
  const urls: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--session") {
      sessionId = args[++i];
    } else if (args[i] === "--pr" && PR_ARG.test(args[i + 1] ?? "")) {
      urls.push(args[++i]);
    } else {
      throw new Error(`bad argument: ${args[i]}. Usage: set [--session <id>] --pr <github pull request url>...`);
    }
  }
  sessionId ??= workingSessionId();
  const record = sessionId ? load(sessionId) : undefined;
  if (!record || urls.length === 0) {
    throw new Error("needs an existing session (--session <id>) and at least one --pr");
  }
  const added = urls.filter((url) => !record.prs.includes(url));
  record.prs.push(...added);
  record.updatedAt = Date.now();
  save(record);
  console.log(`Argus: linked ${added.length} PR(s), ${urls.length - added.length} already linked (session ${record.sessionId}).`);
}

function main(): void {
  if (process.argv[2] === "set") {
    try {
      setPrs(process.argv.slice(3));
    } catch (error) {
      process.stderr.write(`Argus: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }
  // A Claude Code hook must never throw or print unexpected output, since stdout is shown to the agent as context
  // and a thrown error would break the event that invoked it.
  try {
    hookMain();
  } catch {
    // ignore
  }
}

main();
