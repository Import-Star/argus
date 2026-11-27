import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { describeCwd, existingWorktrees, replaceFileSync, terminalSpelling } from "../src/services/paths.ts";

describe("terminalSpelling", () => {
  it("upper-cases a Windows drive letter, so Claude Code finds the folder's settings a terminal saved", () => {
    assert.equal(terminalSpelling("c:\\Users\\me\\repo", "win32"), "C:\\Users\\me\\repo");
    assert.equal(terminalSpelling("C:\\Users\\me\\repo", "win32"), "C:\\Users\\me\\repo");
    assert.equal(terminalSpelling("c:/x", "linux"), "c:/x");
  });
});

describe("describeCwd", () => {
  it("names the repo and worktree of worktree folders, Claude Code's included", () => {
    assert.deepEqual(describeCwd("/work/hub/.worktrees/fix/src", "linux"), { repo: "hub", worktree: "fix" });
    assert.deepEqual(describeCwd("/work/hub/.claude/worktrees/fix", "linux"), { repo: "hub", worktree: "fix" });
    assert.deepEqual(describeCwd("C:\\work\\hub\\worktrees\\fix", "win32"), { repo: "hub", worktree: "fix" });
    assert.deepEqual(describeCwd("C:/work/hub/.worktrees/fix", "win32"), { repo: "hub", worktree: "fix" });
  });
  it("treats any other .claude folder as a plain folder", () => {
    assert.deepEqual(describeCwd("C:\\Users\\me\\.claude\\argus\\plugins\\kanban", "win32"), { repo: "kanban" });
    assert.deepEqual(describeCwd("/home/me/.claude", "linux"), { repo: ".claude" });
  });
});

describe("replaceFileSync", () => {
  it("replaces a file another process keeps reading", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-replace-"));
    const target = path.join(dir, "s.json");
    fs.writeFileSync(target, "{}");
    // Windows refuses the rename (EPERM) while the reader has the file open.
    const reader = spawn(process.execPath, ["-e", `const fs=require("fs");for(;;){try{fs.readFileSync(${JSON.stringify(target)})}catch{}}`]);
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      for (let i = 0; i < 50; i++) {
        fs.writeFileSync(`${target}.tmp`, `{"i":${i}}`);
        replaceFileSync(`${target}.tmp`, target, 200);
      }
      assert.equal(fs.readFileSync(target, "utf8"), '{"i":49}');
      assert.deepEqual(fs.readdirSync(dir), ["s.json"]);
    } finally {
      reader.kill();
      await new Promise((resolve) => reader.once("exit", resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

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
