import * as fs from "fs";
import * as path from "path";

// Folder paths are compared by this key. Windows and macOS file systems ignore case, and the same folder arrives
// spelt differently: VS Code passes `c:\...`, git and terminals print `C:\...` or `C:/...`. Keep in step with
// normalize in sessionScopeFilter.ts and pathKey in hooks/session-tracker.ts.
export function pathKey(folder: string): string {
  const resolved = path.resolve(folder);
  return process.platform === "win32" || process.platform === "darwin" ? resolved.toLowerCase() : resolved;
}

// A Windows folder with its drive letter upper case, as terminals and git spell it. VS Code passes `c:\...`, and
// Claude Code keeps per-folder settings (trust, MCP servers) in ~/.claude.json under the spelling it was started
// with, so `c:/...` would miss what a terminal session set up under `C:/...`.
export function terminalSpelling(folder: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? folder.replace(/^([a-z]):/, (_, drive: string) => `${drive.toUpperCase()}:`) : folder;
}

// The repo and worktree names a card shows for a session's folder: `<repo>/.worktrees/<name>`, `<repo>/worktrees/<name>`
// and Claude Code's `<repo>/.claude/worktrees/<name>` are worktrees, anything else is a repo named after its folder.
export function describeCwd(cwd: string, platform: NodeJS.Platform = process.platform): { repo: string; worktree?: string } {
  // Windows takes `/` too, as in a cwd a terminal or tool reported as `C:/...`.
  const parts = cwd.split(platform === "win32" ? /[\\/]/ : "/").filter(Boolean);
  const index = parts.findIndex((part, i) => (part === "worktrees" || part === ".worktrees") && i > 0 && i < parts.length - 1);
  if (index > 0) {
    const repo = parts[index - 1] === ".claude" ? parts[index - 2] : parts[index - 1];
    if (repo) {
      return { repo, worktree: parts[index + 1] };
    }
  }
  return { repo: parts[parts.length - 1] ?? cwd };
}

// Renames `tmp` over `target`, retrying while another process has the target open: on Windows the rename fails then
// (EPERM), and the hook and the board read session files all the time. Removes `tmp` if it gives up.
export function replaceFileSync(tmp: string, target: string, attempts = 10): void {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(tmp, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= attempts || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) {
        fs.rmSync(tmp, { force: true });
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}

// The folders without case or separator variants of one another, keeping the first spelling of each.
export function uniquePaths(folders: readonly string[]): string[] {
  const seen = new Set<string>();
  return folders.filter((folder) => {
    const key = pathKey(folder);
    return seen.has(key) ? false : (seen.add(key), true);
  });
}

// Linked worktree folders by path key. A folder's kind doesn't change while it exists, so only its existence is
// checked again.
const linkedCache = new Map<string, boolean>();

// Whether a folder is the root of a linked worktree: its `.git` is a file pointing at a git dir with a `commondir`
// file. A main checkout has a `.git` folder, and a submodule's git dir has no `commondir`.
export function isLinkedWorktree(folder: string): boolean {
  const key = pathKey(folder);
  const known = linkedCache.get(key);
  if (known !== undefined) {
    return known && fs.existsSync(folder);
  }
  let linked: boolean;
  try {
    const dotGit = path.join(folder, ".git");
    if (fs.statSync(dotGit).isDirectory()) {
      linked = false;
    } else {
      const gitDir = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, "utf8"))?.[1];
      linked = gitDir !== undefined && fs.existsSync(path.join(path.resolve(folder, gitDir), "commondir"));
    }
  } catch {
    // Missing folder or unreadable `.git`: not cached, as the folder may become a worktree again.
    return false;
  }
  linkedCache.set(key, linked);
  return linked;
}

// Worktrees an agent already removed drop off the card. So do main checkouts and second spellings of one folder,
// which older hooks recorded on Windows when the session's folder was spelt in another case than the disk's.
export function existingWorktrees(worktrees: string[] | undefined): string[] | undefined {
  return worktrees && uniquePaths(worktrees).filter(isLinkedWorktree);
}
