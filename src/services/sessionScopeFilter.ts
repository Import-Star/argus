import * as path from "path";
import type { SessionRecord } from "../types";

// Pure matching rules for argus.sessions.scope, kept free of vscode and git so they can be unit tested.

export type SessionScope = "window" | "folder" | "all";

export function parseScope(value: unknown): SessionScope {
  return value === "folder" || value === "all" ? value : "window";
}

export function normalize(folder: string): string {
  const resolved = path.resolve(folder).replace(/[\/]+$/, "");
  return process.platform === "win32" || process.platform === "darwin" ? resolved.toLowerCase() : resolved;
}

function within(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + path.sep);
}

// Builds a predicate for "does this session belong to the folders open in this VS Code window".
// A session belongs when its cwd or a linked worktree is inside a workspace folder. Scope "window" also accepts a
// checkout or worktree of the same git repo (per `repoRoot`); scope "folder" does not, so sibling folders of one
// repo stay apart. With no folder open (or scope "all") everything is shown.
export function sessionFilter(
  folders: readonly string[],
  scope: SessionScope,
  repoRoot: (folder: string) => string | undefined
): (record: Pick<SessionRecord, "cwd" | "worktrees">) => boolean {
  if (scope === "all" || folders.length === 0) {
    return () => true;
  }
  const paths = folders.map(normalize);
  const dirs = (record: Pick<SessionRecord, "cwd" | "worktrees">) => [record.cwd, ...(record.worktrees ?? [])];
  if (scope === "folder") {
    return (record) => dirs(record).some((dir) => paths.some((folder) => within(normalize(dir), folder)));
  }
  const roots = new Set(folders.map(repoRoot).filter((root): root is string => Boolean(root)));
  return (record) =>
    dirs(record).some((dir) => {
      if (paths.some((folder) => within(normalize(dir), folder))) {
        return true;
      }
      const root = repoRoot(dir);
      return root !== undefined && roots.has(root);
    });
}
