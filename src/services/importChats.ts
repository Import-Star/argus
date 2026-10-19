import * as fs from "fs";
import * as path from "path";
import type { SessionRecord } from "../types";

const HEAD_BYTES = 262_144;
const TAIL_BYTES = 1_048_576;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Entry {
  type?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  cwd?: string;
  timestamp?: string;
  aiTitle?: string;
  origin?: { kind?: string };
  customTitle?: string;
  message?: { content?: string | Array<{ type?: string; text?: string }> };
}

export interface ChatCandidate {
  sessionId: string;
  transcriptPath: string;
  mtimeMs: number;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function parseLines(text: string): Entry[] {
  const entries: Entry[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) {
      continue;
    }
    try {
      entries.push(JSON.parse(line) as Entry);
    } catch {
      // A line cut by the head or tail window, or a torn write.
    }
  }
  return entries;
}

function textOf(entry: Entry): string | undefined {
  const content = entry.message?.content;
  const text = typeof content === "string" ? content : (content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n");
  return text.trim() || undefined;
}

// A prompt the person typed: not a tool result, a slash command's wrapper or Claude Code's own meta lines.
function promptOf(entry: Entry): string | undefined {
  if (entry.type !== "user" || entry.isMeta || entry.isSidechain || (entry.origin?.kind && entry.origin.kind !== "human")) {
    return undefined;
  }
  const text = textOf(entry)?.replace(/<ide_[a-z_]+>[\s\S]*?<\/ide_[a-z_]+>/g, "").trim();
  if (!text || /^<(command-|local-command-|system-reminder|task-notification)/.test(text) || text.startsWith("Caveat:")) {
    return undefined;
  }
  return text;
}

function time(entry: Entry | undefined): number | undefined {
  const parsed = entry?.timestamp ? Date.parse(entry.timestamp) : NaN;
  return Number.isNaN(parsed) ? undefined : parsed;
}

// Builds the record the session-tracker hook would have written, from the start and end of a transcript.
// Undefined when the transcript holds no prompt, since such a chat never shows on the board.
export function recordFromTranscript(head: string, tail: string, candidate: ChatCandidate): SessionRecord | undefined {
  const first = parseLines(head);
  const last = parseLines(tail);
  const all = [...first, ...last];
  const cwd = all.find((entry) => typeof entry.cwd === "string")?.cwd;
  const prompts = all.filter((entry) => promptOf(entry));
  const lastPrompt = prompts.at(-1);
  if (!cwd || !lastPrompt) {
    return undefined;
  }
  const titleEntry = all.filter((entry) => (entry.type === "custom-title" && entry.customTitle) || (entry.type === "ai-title" && entry.aiTitle)).at(-1);
  const reply = (last.length > 0 ? last : first).filter((entry) => entry.type === "assistant" && !entry.isSidechain && textOf(entry)).at(-1);
  const startedAt = time(first.find((entry) => time(entry))) ?? candidate.mtimeMs;

  return {
    sessionId: candidate.sessionId,
    cwd,
    transcriptPath: candidate.transcriptPath,
    startedAt,
    updatedAt: candidate.mtimeMs,
    stateSince: candidate.mtimeMs,
    lastPromptAt: time(lastPrompt),
    lastMessageAt: time(reply),
    state: "ended",
    endReason: "imported",
    title: clip(titleEntry?.customTitle ?? titleEntry?.aiTitle ?? (promptOf(prompts[0]) as string), 120),
    lastPrompt: clip(promptOf(lastPrompt) as string, 200),
    ...(reply ? { lastMessage: clip(textOf(reply) as string, 300) } : {}),
    prs: []
  };
}

// Top-level transcripts in ~/.claude/projects/<project>/<session>.jsonl changed since `since` that Argus has no
// record for. Sub-agent transcripts live a level deeper and are skipped.
export function findChats(projectsDir: string, sessionsDir: string, since: number): ChatCandidate[] {
  const found: ChatCandidate[] = [];
  let projects: fs.Dirent[];
  try {
    projects = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const project of projects) {
    if (!project.isDirectory()) {
      continue;
    }
    const dir = path.join(projectsDir, project.name);
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter((file) => file.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const file of files) {
      const sessionId = file.slice(0, -".jsonl".length);
      if (!SESSION_ID.test(sessionId) || fs.existsSync(path.join(sessionsDir, `${sessionId}.json`))) {
        continue;
      }
      const transcriptPath = path.join(dir, file);
      try {
        const { mtimeMs } = fs.statSync(transcriptPath);
        if (mtimeMs >= since) {
          found.push({ sessionId, transcriptPath, mtimeMs });
        }
      } catch {
        // Deleted while scanning.
      }
    }
  }
  return found;
}

function readWindow(file: string, size: number, start: number, length: number): string {
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(Math.max(0, Math.min(length, size - start)));
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

export function readChat(candidate: ChatCandidate): SessionRecord | undefined {
  try {
    const { size } = fs.statSync(candidate.transcriptPath);
    const head = readWindow(candidate.transcriptPath, size, 0, HEAD_BYTES);
    const tail = size > HEAD_BYTES ? readWindow(candidate.transcriptPath, size, Math.max(HEAD_BYTES, size - TAIL_BYTES), TAIL_BYTES) : "";
    return recordFromTranscript(head, tail, candidate);
  } catch {
    return undefined;
  }
}

// Writes records for the given chats, never replacing one the hook has written meanwhile. Returns the ids written.
export function writeChats(records: SessionRecord[], sessionsDir: string): string[] {
  fs.mkdirSync(sessionsDir, { recursive: true });
  const written: string[] = [];
  for (const record of records) {
    try {
      fs.writeFileSync(path.join(sessionsDir, `${record.sessionId}.json`), JSON.stringify(record, null, 2), { flag: "wx" });
      written.push(record.sessionId);
    } catch {
      // Already exists, or unwritable: leave it.
    }
  }
  return written;
}
