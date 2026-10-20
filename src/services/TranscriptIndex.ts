import * as fs from "fs";
import * as path from "path";
import type { SessionTimer, SessionUsage } from "../types";

interface FileState {
  offset: number;
  // Claude Code writes one line per content block, each repeating the message's usage, so count by message id.
  calls: Map<string, { used: number; cacheRead: number }>;
  contextTokens?: number;
  compactions: number;
  texts: string[];
  lower?: string;
  // Calls that start a timer, kept until their result says whether it started.
  uses: Map<string, { name: string; input: Record<string, unknown> }>;
  timers: Map<string, SessionTimer>;
}

type ContentBlock = {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
};

interface TranscriptEntry {
  type?: string;
  subtype?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  timestamp?: string;
  // Queued prompts and background-task notices, on "queue-operation" lines.
  content?: string;
  toolUseResult?: Record<string, unknown>;
  message?: {
    id?: string;
    content?: string | ContentBlock[];
    usage?: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number };
  };
}

const WAKEUP = "wakeup";
const CRON_EXPIRY_MS = 7 * 86_400_000;
// A notice with a status means the task ended; Monitor events carry none.
const TASK_ENDED = /<task-id>([^<]+)<\/task-id>(?:(?!<\/task-notification>)[\s\S])*?<status>/g;
const AGENT_ENDED = /<agent-message from="([^"]+)"/g;

export interface TranscriptRef {
  sessionId: string;
  transcriptPath: string;
}

// Reads Claude Code transcripts incrementally (only bytes appended since the last read) for token use and search.
export class TranscriptIndex {
  private readonly files = new Map<string, FileState>();
  private readonly inflight = new Map<string, Promise<boolean>>();
  private readonly subagents = new Map<string, string[]>();

  public usage(ref: TranscriptRef): SessionUsage | undefined {
    const main = this.files.get(ref.transcriptPath);
    if (!main) {
      return undefined;
    }
    const usage: SessionUsage = { contextTokens: main.contextTokens, usedTokens: 0, cacheReadTokens: 0, compactions: main.compactions };
    for (const file of [ref.transcriptPath, ...(this.subagents.get(ref.sessionId) ?? [])]) {
      for (const call of this.files.get(file)?.calls.values() ?? []) {
        usage.usedTokens += call.used;
        usage.cacheReadTokens += call.cacheRead;
      }
    }
    return usage;
  }

  // Timers set since the Claude process started; older ones died with an earlier process.
  public timers(transcriptPath: string, processStart: number, now = Date.now()): SessionTimer[] {
    return [...(this.files.get(transcriptPath)?.timers.values() ?? [])].filter(
      (timer) =>
        timer.since >= processStart &&
        (timer.kind !== "cron" || now - timer.since < CRON_EXPIRY_MS) &&
        (timer.at === undefined || timer.at > now || timer.schedule !== undefined)
    );
  }

  // Reads new transcript lines for each session. True when anything changed.
  public async update(refs: readonly TranscriptRef[]): Promise<boolean> {
    let changed = false;
    for (const ref of refs) {
      const subagents = await this.listSubagents(ref);
      this.subagents.set(ref.sessionId, subagents);
      const results = await Promise.all([this.sync(ref.transcriptPath, true), ...subagents.map((file) => this.sync(file, false))]);
      changed = results.some(Boolean) || changed;
    }
    return changed;
  }

  // Sessions whose prompts or replies contain every term, with a snippet around the first term.
  public async search(refs: readonly TranscriptRef[], query: string): Promise<Map<string, string>> {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = new Map<string, string>();
    if (terms.length === 0) {
      return matches;
    }
    await Promise.all(refs.map((ref) => this.sync(ref.transcriptPath, true)));
    for (const ref of refs) {
      const state = this.files.get(ref.transcriptPath);
      if (!state) {
        continue;
      }
      state.lower ??= state.texts.join("\n").toLowerCase();
      if (terms.every((term) => state.lower?.includes(term))) {
        matches.set(ref.sessionId, snippet(state.texts, terms[0]));
      }
    }
    return matches;
  }

  private async listSubagents(ref: TranscriptRef): Promise<string[]> {
    const dir = subagentDir(ref);
    try {
      const names = await fs.promises.readdir(dir);
      return names.filter((name) => name.endsWith(".jsonl")).map((name) => path.join(dir, name));
    } catch {
      return [];
    }
  }

  // Serialises reads per file so two callers never ingest the same bytes twice.
  private sync(file: string, withText: boolean): Promise<boolean> {
    const previous = this.inflight.get(file) ?? Promise.resolve(false);
    const next = previous.then(() => this.read(file, withText));
    this.inflight.set(file, next);
    void next.finally(() => {
      if (this.inflight.get(file) === next) {
        this.inflight.delete(file);
      }
    });
    return next;
  }

  private async read(file: string, withText: boolean): Promise<boolean> {
    try {
      const { size } = await fs.promises.stat(file);
      let state = this.files.get(file);
      if (state && size === state.offset) {
        return false;
      }
      if (!state || size < state.offset) {
        state = { offset: 0, calls: new Map(), compactions: 0, texts: [], uses: new Map(), timers: new Map() };
        this.files.set(file, state);
      }
      const handle = await fs.promises.open(file, "r");
      try {
        const buffer = Buffer.alloc(size - state.offset);
        await handle.read(buffer, 0, buffer.length, state.offset);
        // A line still being written has no newline yet; leave it for the next read.
        const end = buffer.lastIndexOf(0x0a) + 1;
        if (end === 0) {
          return false;
        }
        for (const line of buffer.subarray(0, end).toString("utf8").split("\n")) {
          ingest(state, line, withText);
        }
        state.offset += end;
        state.lower = undefined;
        return true;
      } finally {
        await handle.close();
      }
    } catch {
      return false;
    }
  }
}

function subagentDir(ref: TranscriptRef): string {
  return path.join(path.dirname(ref.transcriptPath), ref.sessionId, "subagents");
}

function ingest(state: FileState, line: string, withText: boolean): void {
  // Skip parsing tool results and other large lines that can't hold usage, prompts or a compaction marker.
  const timerLine = withText && line.includes('"type":"queue-operation"');
  if (!line.includes('"type":"assistant"') && !line.includes('"compact_boundary"') && !(withText && line.includes('"type":"user"')) && !timerLine) {
    return;
  }
  let entry: TranscriptEntry;
  try {
    entry = JSON.parse(line) as TranscriptEntry;
  } catch {
    return;
  }
  if (entry.type === "system" && entry.subtype === "compact_boundary") {
    state.compactions += 1;
    return;
  }
  if (entry.type === "assistant") {
    const usage = entry.message?.usage;
    const id = entry.message?.id;
    if (usage && id) {
      const input = usage.input_tokens ?? 0;
      const cacheWrite = usage.cache_creation_input_tokens ?? 0;
      const cacheRead = usage.cache_read_input_tokens ?? 0;
      state.calls.set(id, { used: input + cacheWrite + (usage.output_tokens ?? 0), cacheRead });
      if (!entry.isSidechain) {
        state.contextTokens = input + cacheWrite + cacheRead;
      }
    }
  }
  if (withText) {
    trackTimers(state, entry);
  }
  if (!withText || entry.isMeta || (entry.type !== "assistant" && entry.type !== "user")) {
    return;
  }
  const content = entry.message?.content;
  const blocks = textBlocks(content);
  for (const text of blocks) {
    const clean = text.replace(/<(ide_[a-z_]+|system-reminder)>[\s\S]*?<\/\1>/g, "").trim();
    if (clean) {
      state.texts.push(clean);
    }
  }
}

function textBlocks(content: string | ContentBlock[] | undefined): string[] {
  return typeof content === "string" ? [content] : (content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "");
}

function trackTimers(state: FileState, entry: TranscriptEntry): void {
  const since = entry.timestamp ? Date.parse(entry.timestamp) : Date.now();
  if (entry.type === "queue-operation" || entry.type === "user") {
    const text = entry.type === "queue-operation" ? (entry.content ?? "") : textBlocks(entry.message?.content).join("\n");
    for (const match of [...text.matchAll(TASK_ENDED), ...text.matchAll(AGENT_ENDED)]) {
      state.timers.delete(match[1]);
    }
  }
  const content = entry.message?.content;
  const blocks = Array.isArray(content) ? content : [];
  for (const block of blocks) {
    const input = block.input ?? {};
    if (block.type === "tool_use" && block.id && block.name) {
      if (block.name === "TaskStop" || block.name === "CronDelete") {
        state.timers.delete(String(input.task_id ?? input.id));
      } else if (["Monitor", "ScheduleWakeup", "CronCreate"].includes(block.name) || (block.name === "Bash" && input.run_in_background === true)) {
        state.uses.set(block.id, { name: block.name, input });
      }
    }
    if (block.type === "tool_result" && block.tool_use_id && !block.is_error) {
      const use = state.uses.get(block.tool_use_id);
      state.uses.delete(block.tool_use_id);
      const timer = timerFrom(use, entry.toolUseResult ?? {}, since);
      if (timer) {
        state.timers.set(timer.id, timer.timer);
      } else if (use?.name === "ScheduleWakeup") {
        state.timers.delete(WAKEUP);
      }
    }
  }
}

function timerFrom(
  use: { name: string; input: Record<string, unknown> } | undefined,
  result: Record<string, unknown>,
  since: number
): { id: string; timer: SessionTimer } | undefined {
  const label = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (result.isAsync === true && typeof result.agentId === "string") {
    return { id: result.agentId, timer: { kind: "agent", label: label(result.description), since } };
  }
  switch (use?.name) {
    case "Bash":
      return typeof result.backgroundTaskId === "string"
        ? { id: result.backgroundTaskId, timer: { kind: "command", label: label(use.input.description ?? use.input.command), since } }
        : undefined;
    case "Monitor":
      return typeof result.taskId === "string" ? { id: result.taskId, timer: { kind: "monitor", label: label(use.input.description), since } } : undefined;
    case "ScheduleWakeup":
      return typeof result.scheduledFor === "number" && result.scheduledFor > 0 && result.stopped !== true
        ? { id: WAKEUP, timer: { kind: "wakeup", label: label(use.input.reason), since, at: result.scheduledFor } }
        : undefined;
    case "CronCreate":
      return typeof result.id === "string"
        ? {
            id: result.id,
            timer: {
              kind: "cron",
              label: label(use.input.prompt),
              since,
              at: typeof result.nextFireAt === "number" ? result.nextFireAt : undefined,
              schedule: result.recurring === true ? String(result.humanSchedule ?? use.input.cron) : undefined
            }
          }
        : undefined;
    default:
      return undefined;
  }
}

function snippet(texts: string[], term: string): string {
  const text = texts.find((candidate) => candidate.toLowerCase().includes(term)) ?? "";
  const flat = text.replace(/\s+/g, " ");
  const at = flat.toLowerCase().indexOf(term);
  const start = Math.max(0, at - 60);
  const end = Math.min(flat.length, at + term.length + 100);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}
