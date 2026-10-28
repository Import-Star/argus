import * as fs from "fs";
import type { PrSummary, SessionColumn, SessionRecord } from "../types";

export interface RegistryEntry {
  pid: number;
  sessionId: string;
  name?: string;
  nameSource?: string;
  status?: string;
  statusUpdatedAt?: number;
  startedAt?: number;
}

export interface LiveChat {
  sessionId: string;
  busy: boolean;
  since: number;
}

// An Argus chat counts as open even when Claude Code's registry has no file for it (yet); a real entry wins.
export function withLiveChats(registry: Map<string, RegistryEntry>, chats: readonly LiveChat[], pid: number): Map<string, RegistryEntry> {
  const merged = new Map(registry);
  for (const chat of chats) {
    if (!merged.has(chat.sessionId)) {
      merged.set(chat.sessionId, { pid, sessionId: chat.sessionId, status: chat.busy ? "busy" : "idle", statusUpdatedAt: chat.since, startedAt: chat.since });
    }
  }
  return merged;
}

// A prompt sent after archiving brings the session back.
export function isArchivedManually(record: SessionRecord, archivedAt: number | undefined): boolean {
  return (archivedAt ?? -1) > (record.lastPromptAt ?? 0);
}

// Worktrees an agent already removed should drop off the card.
export function existingWorktrees(worktrees: string[] | undefined): string[] | undefined {
  return worktrees?.filter((folder) => fs.existsSync(folder));
}

// Claude Code fires no hook on Esc, so a turn that never reached Stop shows as "working" in our record. Once the
// registry has gone idle after our last update, or the process is gone, that turn was cut short.
export function isInterrupted(record: SessionRecord, registry: RegistryEntry | undefined): boolean {
  if (record.state !== "working") {
    return false;
  }
  if (!registry) {
    return true;
  }
  return registry.status !== "busy" && (registry.statusUpdatedAt ?? 0) > record.updatedAt;
}

export function columnFor(
  record: SessionRecord,
  registry: RegistryEntry | undefined,
  prs: PrSummary[],
  read: boolean,
  archivedManually: boolean,
  interrupted: boolean,
  scheduled = false
): SessionColumn | undefined {
  // A PR merged or closed since the last prompt keeps the card in the PR column until the user messages it again.
  const anyPrOpen = prs.some((pr) => pr.state === "OPEN" || (pr.closedAt !== undefined && Date.parse(pr.closedAt) > (record.lastPromptAt ?? 0)));
  const closed = !registry;

  if (closed && !record.lastPrompt && !record.title) {
    return undefined;
  }
  // The main agent can Stop while background sub-agents keep the session busy, and Claude Code's own registry
  // stays "busy" throughout. Only call it done once the registry says the session is no longer busy.
  const needsYou = interrupted || record.state === "permission" || record.state === "question" || (record.state === "done" && !read && registry?.status !== "busy");
  if (archivedManually) {
    return "archived";
  }
  if (needsYou) {
    return "needs-you";
  }
  if (registry?.status === "busy" || record.state === "working") {
    return "working";
  }
  if (scheduled) {
    return "scheduled";
  }
  if (anyPrOpen) {
    return "pr-open";
  }
  return "idle";
}
