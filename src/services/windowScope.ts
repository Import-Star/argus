import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { SessionRecord } from "../types";
import { normalize, parseScope, sessionFilter, SessionScope } from "./sessionScopeFilter";

// Missing folders and non-git folders never become git repos in the lifetime of a window, so cache their
// "not a repo" result for a long time instead of re-running git every scope check (previously 30s, which meant a
// blocking git spawn every refresh for every closed/missing worktree).
const NEGATIVE_TTL_MS = 6 * 3_600_000;
const rootCache = new Map<string, { root: string | undefined; at: number }>();

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

export function sessionScope(): SessionScope {
  return parseScope(vscode.workspace.getConfiguration("argus").get<string>("sessions.scope", "window"));
}

export function windowFilter(): (record: SessionRecord) => boolean {
  const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
  return sessionFilter(folders, sessionScope(), repoRoot);
}
