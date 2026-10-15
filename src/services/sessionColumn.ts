import * as fs from "fs";
import type { PrSummary, SessionColumn, SessionRecord } from "../types";

export interface RegistryEntry {
  pid: number;
  sessionId: string;
  name?: string;
  nameSource?: string;
  status?: string;
  statusUpdatedAt?: number;
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
  interrupted: boolean
): SessionColumn | undefined {
  const anyPrOpen = prs.some((pr) => pr.state === "OPEN");
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
  if (anyPrOpen) {
    return "pr-open";
  }
  return "idle";
}
