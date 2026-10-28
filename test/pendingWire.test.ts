import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { answeredInput, summarize, toWirePending } from "../src/chat/pendingWire.ts";
import type { PermissionRequest } from "../src/chat/protocol.ts";

function request(toolName: string, input: Record<string, unknown>, extra: Partial<PermissionRequest> = {}): PermissionRequest {
  return { id: "r1", toolName, input, createdAt: 1, ...extra };
}

const ask = request("AskUserQuestion", {
  questions: [
    { question: "Which cache?", header: "Cache", multiSelect: false, options: [{ label: "Off", description: "no cache" }, { label: "Mount", description: "build cache" }] }
  ]
});

describe("summarize", () => {
  it("uses the Bash command", () => {
    assert.equal(summarize(request("Bash", { command: "yarn build" })), "yarn build");
  });
  it("uses the file path for edits", () => {
    assert.equal(summarize(request("Edit", { file_path: "/a/b.ts", old_string: "x" })), "/a/b.ts");
  });
  it("uses the first question for AskUserQuestion", () => {
    assert.equal(summarize(ask), "Which cache?");
  });
  it("truncates long commands", () => {
    assert.equal(summarize(request("Bash", { command: "x".repeat(500) })).length, 241);
  });
});

describe("toWirePending", () => {
  it("carries questions only for AskUserQuestion", () => {
    assert.equal(toWirePending(ask).questions?.[0].options[1].label, "Mount");
    assert.equal(toWirePending(request("Bash", { command: "ls" }, { alwaysLabel: "Bash(ls:*)" })).questions, undefined);
  });
});

describe("answeredInput", () => {
  it("adds answers keyed by question text", () => {
    const result = answeredInput(ask.input, { "Which cache?": "Off" });
    assert.deepEqual(result?.answers, { "Which cache?": "Off" });
    assert.ok(result?.questions);
  });
  it("rejects missing or unknown answers", () => {
    assert.equal(answeredInput(ask.input, {}), undefined);
    assert.equal(answeredInput(ask.input, { Other: "x" }), undefined);
    assert.equal(answeredInput(ask.input, undefined), undefined);
  });
});
