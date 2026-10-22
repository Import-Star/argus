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

// A chat closed before its first prompt has no transcript, so it can't be resumed.
export function hasTranscript(sessionId: string, projectsDir = path.join(os.homedir(), ".claude", "projects")): boolean {
  try {
    return fs.readdirSync(projectsDir).some((folder) => fs.existsSync(path.join(projectsDir, folder, `${sessionId}.jsonl`)));
  } catch {
    return false;
  }
}
