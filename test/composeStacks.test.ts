import assert from "node:assert/strict";
import * as path from "node:path";
import { describe, it } from "node:test";
import type { SessionRecord } from "../src/types.ts";
import { fromWsl, ownsProject } from "../src/services/composeStacks.ts";

describe("fromWsl", () => {
  it("maps a WSL /mnt path to its Windows folder, and leaves the distro's own folders", () => {
    assert.equal(fromWsl("/mnt/c/Users/me/repo"), "C:\\Users\\me\\repo");
    assert.equal(fromWsl("/mnt/d"), "D:\\");
    assert.equal(fromWsl("/home/me/repo"), "/home/me/repo");
  });
});

const root = path.resolve("/work");
const record = (fields: Partial<SessionRecord>): SessionRecord => ({ sessionId: "s1", cwd: root, startedAt: 0, updatedAt: 0, stateSince: 0, state: "idle", prs: [], ...fields });

describe("ownsProject", () => {
  it("matches a project run from inside a worktree, not one beside it", () => {
    const session = record({ worktrees: [path.join(root, "wt")] });
    assert.equal(ownsProject(session, { name: "a", running: true, dir: path.join(root, "wt", "lib") }), true);
    assert.equal(ownsProject(session, { name: "b", running: true, dir: path.join(root, "wt-2") }), false);
  });
  it("matches a named stack by name, and an unnamed one only by its exact folder", () => {
    const session = record({ composeStacks: [{ dir: path.join(root, "repo"), project: "mine" }, { dir: path.join(root, "other") }] });
    assert.equal(ownsProject(session, { name: "mine", running: true, dir: path.join(root, "elsewhere") }), true);
    assert.equal(ownsProject(session, { name: "theirs", running: true, dir: path.join(root, "repo") }), false);
    assert.equal(ownsProject(session, { name: "x", running: true, dir: path.join(root, "other") }), true);
    assert.equal(ownsProject(session, { name: "y", running: true, dir: path.join(root, "other", "sub") }), false);
  });
});
