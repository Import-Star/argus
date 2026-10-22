import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { hasTranscript, readPanelState } from "../chat/host/restore.ts";
import { columnFor, withLiveChats, type RegistryEntry } from "../src/services/sessionColumn.ts";
import type { SessionRecord } from "../src/types.ts";

const record = { sessionId: "a", cwd: "/x", startedAt: 1, updatedAt: 1, stateSince: 1, state: "ended", prs: [] } as unknown as SessionRecord;

describe("withLiveChats", () => {
  it("shows a brand-new Argus chat with no prompt, title or registry file", () => {
    assert.equal(columnFor(record, undefined, [], true, false, false), undefined);
    const registry = withLiveChats(new Map(), [{ sessionId: "a", busy: false, since: 5 }], 99);
    assert.equal(columnFor(record, registry.get("a"), [], true, false, false), "idle");
  });
  it("marks a busy chat as working", () => {
    const registry = withLiveChats(new Map(), [{ sessionId: "a", busy: true, since: 5 }], 99);
    assert.equal(columnFor({ ...record, state: "working", updatedAt: 9 }, registry.get("a"), [], true, false, false), "working");
  });
  it("keeps Claude Code's own registry entry", () => {
    const real: RegistryEntry = { pid: 1, sessionId: "a", status: "busy" };
    assert.equal(withLiveChats(new Map([["a", real]]), [{ sessionId: "a", busy: false, since: 5 }], 99).get("a"), real);
  });
});

describe("panel restore", () => {
  it("reads saved panel state and rejects junk", () => {
    assert.deepEqual(readPanelState({ view: "grid", sessionIds: ["a", 3, "b"], groupId: "a" }), { view: "grid", sessionIds: ["a", "b"], groupId: "a" });
    assert.equal(readPanelState({ sessionIds: [] }), undefined);
    assert.equal(readPanelState(undefined), undefined);
  });
  it("finds a transcript only once the first prompt was sent", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-proj-"));
    fs.mkdirSync(path.join(dir, "-x"));
    assert.equal(hasTranscript("a", dir), false);
    fs.writeFileSync(path.join(dir, "-x", "a.jsonl"), "");
    assert.equal(hasTranscript("a", dir), true);
  });
});
