import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import type { PrSummary, SessionRecord } from "../src/types.ts";
import { columnFor, existingWorktrees, isArchivedManually, isInterrupted, type RegistryEntry } from "../src/services/sessionColumn.ts";

const NOW = 1_000_000;

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return { sessionId: "s1", cwd: "/repo", startedAt: NOW, updatedAt: NOW, stateSince: NOW, state: "idle", prs: [], lastPrompt: "hi", ...overrides };
}

const open: RegistryEntry = { pid: 1, sessionId: "s1", status: "idle" };

function column(r: SessionRecord, opts: { registry?: RegistryEntry; prs?: PrSummary[]; read?: boolean; archivedAt?: number; scheduled?: boolean } = {}) {
  const registry = "registry" in opts ? opts.registry : open;
  return columnFor(r, registry, opts.prs ?? [], opts.read ?? false, isArchivedManually(r, opts.archivedAt), isInterrupted(r, registry), opts.scheduled);
}

describe("isArchivedManually", () => {
  it("stays archived when no prompt came after the archive", () => {
    assert.equal(isArchivedManually(record({ lastPromptAt: 100 }), 200), true);
  });
  it("unarchives when a prompt is sent after the archive", () => {
    assert.equal(isArchivedManually(record({ lastPromptAt: 300 }), 200), false);
  });
  it("is archived for records written before lastPromptAt existed", () => {
    assert.equal(isArchivedManually(record(), 200), true);
  });
  it("is not archived when never archived", () => {
    assert.equal(isArchivedManually(record(), undefined), false);
  });
});

describe("columnFor", () => {
  it("puts a manually archived session in archived", () => {
    assert.equal(column(record({ lastPromptAt: 1 }), { archivedAt: 2 }), "archived");
  });
  it("moves an archived session back once a new prompt is sent", () => {
    assert.equal(column(record({ state: "working", lastPromptAt: 3 }), { archivedAt: 2, registry: { ...open, status: "busy" } }), "working");
  });
  it("shows a finished unread turn as needs-you", () => {
    assert.equal(column(record({ state: "done" })), "needs-you");
  });
  it("shows a finished read turn as idle", () => {
    assert.equal(column(record({ state: "done" }), { read: true }), "idle");
  });
  it("keeps a session working while the registry is busy, even after Stop", () => {
    assert.equal(column(record({ state: "done" }), { registry: { ...open, status: "busy" } }), "working");
  });
  it("flags a working session whose process is gone as needs-you", () => {
    assert.equal(column(record({ state: "working" }), { registry: undefined }), "needs-you");
  });
  it("keeps an interrupted session with merged PRs in needs-you", () => {
    const pr = { state: "MERGED" } as PrSummary;
    assert.equal(column(record({ state: "working", prs: ["u"] }), { prs: [pr], registry: { ...open, status: "idle", statusUpdatedAt: NOW + 1 } }), "needs-you");
  });
  it("hides a closed session that never had a prompt or title", () => {
    assert.equal(column(record({ lastPrompt: undefined }), { registry: undefined }), undefined);
  });
  it("shows pr-open when a linked PR is open", () => {
    const pr = { url: "u", state: "OPEN" } as PrSummary;
    assert.equal(column(record({ prs: ["u"] }), { prs: [pr], read: true }), "pr-open");
  });
  it("keeps a PR merged since the last prompt in pr-open", () => {
    const pr = { url: "u", state: "MERGED", closedAt: new Date(2_000).toISOString() } as PrSummary;
    assert.equal(column(record({ prs: ["u"], lastPromptAt: 1_000 }), { prs: [pr], read: true }), "pr-open");
  });
  it("moves a merged PR to idle once the user prompts again", () => {
    const pr = { url: "u", state: "MERGED", closedAt: new Date(2_000).toISOString() } as PrSummary;
    assert.equal(column(record({ prs: ["u"], lastPromptAt: 3_000 }), { prs: [pr], read: true }), "idle");
  });
  it("puts an idle session with a timer in scheduled, ahead of pr-open", () => {
    const pr = { url: "u", state: "OPEN" } as PrSummary;
    assert.equal(column(record({ prs: ["u"] }), { prs: [pr], read: true, scheduled: true }), "scheduled");
  });
  it("keeps a finished, unread session with a timer in needs-you", () => {
    assert.equal(column(record({ state: "done" }), { scheduled: true }), "needs-you");
  });
  it("keeps a session with every linked PR merged out of archived", () => {
    const pr = { url: "u", state: "MERGED" } as PrSummary;
    assert.equal(column(record({ prs: ["u"] }), { prs: [pr] }), "idle");
  });
});

describe("existingWorktrees", () => {
  it("drops worktree folders that no longer exist", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-wt-"));
    try {
      assert.deepEqual(existingWorktrees([dir, path.join(dir, "gone")]), [dir]);
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });
});
