import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface PanelState {
  view: "single" | "grid";
  sessionIds: string[];
  groupId?: string;
}

export function readPanelState(state: unknown): PanelState | undefined {
  const value = state as Partial<PanelState> | undefined;
  if (!value || !Array.isArray(value.sessionIds)) {
    return undefined;
  }
  const sessionIds = value.sessionIds.filter((id): id is string => typeof id === "string");
  return sessionIds.length > 0 ? { view: value.view === "grid" ? "grid" : "single", sessionIds, groupId: typeof value.groupId === "string" ? value.groupId : undefined } : undefined;
}

export function findTranscript(sessionId: string, projectsDir = path.join(os.homedir(), ".claude", "projects")): string | undefined {
  try {
    const folder = fs.readdirSync(projectsDir).find((name) => fs.existsSync(path.join(projectsDir, name, `${sessionId}.jsonl`)));
    return folder === undefined ? undefined : path.join(projectsDir, folder, `${sessionId}.jsonl`);
  } catch {
    return undefined;
  }
}

// A chat closed before its first prompt has no transcript, so it can't be resumed.
export function hasTranscript(sessionId: string, projectsDir?: string): boolean {
  return findTranscript(sessionId, projectsDir) !== undefined;
}

interface TranscriptLine {
  type?: string;
  subtype?: string;
  uuid?: string;
  parentUuid?: string | null;
  content?: string;
  sessionId?: string;
}

// getSessionMessages drops system lines, so a local command's output (a forked skill's whole reply) vanished on reopen.
export function withLocalCommandOutput<T extends { uuid?: string }>(messages: T[], sessionId: string, projectsDir?: string): T[] {
  const file = findTranscript(sessionId, projectsDir);
  let transcript: string;
  try {
    transcript = file ? fs.readFileSync(file, "utf8") : "";
  } catch {
    return messages;
  }
  const lines = transcript.split("\n").flatMap((line): TranscriptLine[] => {
    try {
      return [JSON.parse(line) as TranscriptLine];
    } catch {
      return [];
    }
  });
  const parents = new Map(lines.filter((line) => line.uuid).map((line) => [line.uuid, line.parentUuid ?? undefined]));
  const kept = new Set(messages.map((message) => message.uuid));
  const after = new Map<string, T[]>();
  for (const line of lines) {
    const content = line.type === "system" && line.subtype === "local_command" ? (line.content ?? "").replace(/<\/?local-command-std(?:out|err)>/g, "").trim() : "";
    let at = line.parentUuid ?? undefined;
    while (at && !kept.has(at)) {
      at = parents.get(at);
    }
    if (content && at) {
      after.set(at, [...(after.get(at) ?? []), { type: "system", subtype: "local_command_output", content, uuid: line.uuid, session_id: line.sessionId } as unknown as T]);
    }
  }
  return messages.flatMap((message) => [message, ...(after.get(message.uuid ?? "") ?? [])]);
}
