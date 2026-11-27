import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { existingWorktrees } from "../src/services/paths.ts";

describe("existingWorktrees", () => {
  // A main checkout with one linked worktree, and a folder whose `.git` file points at a git dir with no
  // `commondir`, as a submodule's does.
  function repoWithWorktree(): { dir: string; repo: string; wt: string; submodule: string } {
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "argus-wt-")));
    const repo = path.join(dir, "repo");
    const wt = path.join(dir, "wt");
    const submodule = path.join(dir, "sub");
    fs.mkdirSync(repo);
    const git = (...args: string[]) => assert.equal(spawnSync("git", ["-C", repo, ...args]).status, 0);
    git("init", "-q");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
    git("worktree", "add", "-q", wt);
    fs.mkdirSync(path.join(repo, ".git", "modules", "sub"), { recursive: true });
    fs.mkdirSync(submodule);
    fs.writeFileSync(path.join(submodule, ".git"), "gitdir: ../repo/.git/modules/sub\n");
    return { dir, repo, wt, submodule };
  }

  it("keeps linked worktrees and drops removed folders, main checkouts and submodules", () => {
    const { dir, repo, wt, submodule } = repoWithWorktree();
    try {
      assert.deepEqual(existingWorktrees([repo, wt, path.join(dir, "gone"), submodule, dir]), [wt]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("drops a second spelling of the same worktree on Windows and macOS", { skip: process.platform === "linux" }, () => {
    const { dir, wt } = repoWithWorktree();
    try {
      assert.deepEqual(existingWorktrees([wt, wt.toLowerCase(), wt.replace(/\\/g, "/")]), [wt]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
