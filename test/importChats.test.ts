import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { findChats, readChat, recordFromTranscript, writeChats } from "../src/services/importChats.ts";

const ID = "4876d0d9-3e5e-4880-b9e3-c67ebe194608";
const lines = (...entries: object[]) => entries.map((entry) => JSON.stringify(entry)).join("\n");
const candidate = { sessionId: ID, transcriptPath: "/t.jsonl", mtimeMs: 5000 };

const transcript = lines(
  { type: "user", cwd: "/repo", timestamp: "2026-10-01T10:00:00.000Z", message: { content: [{ type: "text", text: "<ide_opened_file>x</ide_opened_file>" }, { type: "text", text: "fix the bug" }] } },
  { type: "user", isMeta: true, message: { content: "Caveat: meta" } },
  { type: "assistant", timestamp: "2026-10-01T10:01:00.000Z", message: { content: [{ type: "text", text: "Fixed." }] } },
  { type: "user", timestamp: "2026-10-01T10:02:00.000Z", message: { content: "<command-name>/clear</command-name>" } },
  { type: "user", timestamp: "2026-10-01T10:03:00.000Z", message: { content: [{ type: "tool_result", content: "ok" }] } },
  { type: "ai-title", aiTitle: "Bug fix" }
);

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-import-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("recordFromTranscript", () => {
  it("builds an ended record from the prompts, title and last reply", () => {
    const record = recordFromTranscript(transcript, "", candidate);
    assert.equal(record?.cwd, "/repo");
    assert.equal(record?.title, "Bug fix");
    assert.equal(record?.titleSource, undefined);
    assert.equal(record?.lastPrompt, "fix the bug");
    assert.equal(record?.lastMessage, "Fixed.");
    assert.equal(record?.state, "ended");
    assert.equal(record?.startedAt, Date.parse("2026-10-01T10:00:00.000Z"));
    assert.equal(record?.updatedAt, 5000);
  });
  it("prefers a /rename title and marks it as the user's", () => {
    const record = recordFromTranscript(transcript, lines({ type: "custom-title", customTitle: "Mine" }), candidate);
    assert.equal(record?.title, "Mine");
    assert.equal(record?.titleSource, "user");
  });
  it("skips a transcript without a typed prompt", () => {
    assert.equal(recordFromTranscript(lines({ type: "user", cwd: "/repo", message: { content: "<command-name>/help</command-name>" } }), "", candidate), undefined);
  });
});

describe("findChats and writeChats", () => {
  it("finds new top-level transcripts and never overwrites an existing record", () => {
    const projects = path.join(dir, "projects");
    const sessions = path.join(dir, "sessions");
    fs.mkdirSync(path.join(projects, "p", ID, "subagents"), { recursive: true });
    fs.writeFileSync(path.join(projects, "p", `${ID}.jsonl`), transcript);
    fs.writeFileSync(path.join(projects, "p", ID, "subagents", "agent-1.jsonl"), transcript);
    fs.writeFileSync(path.join(projects, "p", "notes.jsonl"), transcript);

    const found = findChats(projects, sessions, 0);
    assert.deepEqual(found.map((chat) => chat.sessionId), [ID]);
    const record = readChat(found[0]);
    assert.ok(record);
    assert.deepEqual(writeChats([record], sessions), [ID]);
    assert.deepEqual(writeChats([record], sessions), []);
    assert.deepEqual(findChats(projects, sessions, 0), []);
  });
  it("leaves out chats older than the cutoff", () => {
    const projects = path.join(dir, "projects");
    fs.mkdirSync(path.join(projects, "p"), { recursive: true });
    fs.writeFileSync(path.join(projects, "p", `${ID}.jsonl`), transcript);
    assert.deepEqual(findChats(projects, path.join(dir, "sessions"), Date.now() + 60_000), []);
  });
});
