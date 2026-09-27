import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { SessionRecord } from "../types";

// Missing folders and non-git folders never become git repos in the lifetime of a window, so cache their
// "not a repo" result for a long time instead of re-running git every scope check (previously 30s, which meant a
// blocking git spawn every refresh for every closed/missing worktree).
const NEGATIVE_TTL_MS = 6 * 3_600_000;
const rootCache = new Map<string, { root: string | undefined; at: number }>();

function normalize(folder: string): string {
  const resolved = path.resolve(folder).replace(/[\/]+$/, "");
  return process.platform === "win32" || process.platform === "darwin" ? resolved.toLowerCase() : resolved;
}

function within(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + path.sep);
}

// Main checkout root shared by a repo and all its worktrees, or undefined outside git (or for a deleted folder).
function repoRoot(folder: string): string | undefined {
  const key = normalize(folder);
  const cached = rootCache.get(key);
  if (cached && (cached.root || Date.now() - cached.at < NEGATIVE_TTL_MS)) {
    return cached.root;
  }
  if (!fs.existsSync(folder)) {
    rootCache.set(key, { root: undefined, at: Date.now() });
    return undefined;
  }
  let root: string | undefined;
  try {
    const common = execFileSync("git", ["-C", folder, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    root = normalize(path.dirname(common));
  } catch {
    root = undefined;
  }
  rootCache.set(key, { root, at: Date.now() });
  return root;
}

export function scopeIsWindow(): boolean {
  return vscode.workspace.getConfiguration("argus").get<string>("sessions.scope", "window") === "window";
}

// Builds a predicate for "does this session belong to the folders open in this VS Code window".
// A session belongs when its cwd or a linked worktree is inside a workspace folder, or is a checkout or
// worktree of the same git repo. With no folder open (or scope "all") everything is shown.
export function windowFilter(): (record: SessionRecord) => boolean {
  const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
  if (!scopeIsWindow() || folders.length === 0) {
    return () => true;
  }
  const paths = folders.map(normalize);
  const roots = new Set(folders.map(repoRoot).filter((root): root is string => Boolean(root)));

  return (record) =>
    [record.cwd, ...(record.worktrees ?? [])].some((dir) => {
      const normalized = normalize(dir);
      if (paths.some((folder) => within(normalized, folder))) {
        return true;
      }
      const root = repoRoot(dir);
      return root !== undefined && roots.has(root);
    });
}
