import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

const HOOK = path.join(import.meta.dirname, "..", "hooks", "session-tracker.ts");
let home: string;

function fire(event: Record<string, unknown>): void {
  const result = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: "s1", cwd: home, ...event }), env: { ...process.env, HOME: home }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function saved(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(home, ".claude", "argus", "sessions", "s1.json"), "utf8"));
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-home-"));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe("session-tracker hook", () => {
  it("records the prompt time on UserPromptSubmit", () => {
    const before = Date.now();
    fire({ hook_event_name: "UserPromptSubmit", prompt: "fix the bug" });
    const record = saved();
    assert.equal(record.state, "working");
    assert.equal(record.lastPrompt, "fix the bug");
    assert.ok((record.lastPromptAt as number) >= before);
  });
  it("leaves lastPromptAt alone on Stop", () => {
    fire({ hook_event_name: "UserPromptSubmit", prompt: "hi" });
    const promptAt = saved().lastPromptAt;
    fire({ hook_event_name: "Stop", last_assistant_message: "done" });
    const record = saved();
    assert.equal(record.state, "done");
    assert.equal(record.lastPromptAt, promptAt);
  });
  it("links a worktree created by git worktree add", () => {
    const repo = path.join(home, "repo");
    fs.mkdirSync(repo);
    const git = (...args: string[]) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    git("init", "-q");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
    const wt = path.join(home, "wt");
    git("worktree", "add", "-q", wt);
    fire({ hook_event_name: "PostToolUse", cwd: repo, tool_name: "Bash", tool_input: { command: `git worktree add ${wt}` } });
    assert.deepEqual(saved().worktrees, [fs.realpathSync(wt)]);
  });
});
