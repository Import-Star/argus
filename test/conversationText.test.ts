import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanUserText, conversationMarkdown, conversationTurns, nthLatestReply, parseReplyIndex } from "../src/chat/conversationText.ts";

const say = (type: "user" | "assistant", content: unknown, extra = {}) => ({ type, message: { content }, ...extra });
const messages = [
  say("user", "<system-reminder>ignore</system-reminder>Fix the bug"),
  say("assistant", [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "Looking." }, { type: "tool_use", name: "Read" }]),
  say("user", [{ type: "tool_result", content: "file" }]),
  say("assistant", [{ type: "text", text: "Fixed." }]),
  say("assistant", [{ type: "text", text: "sub-agent chatter" }], { parent_tool_use_id: "t1" }),
  say("user", "<local-command-stdout>noise</local-command-stdout>"),
  say("user", "Thanks", { origin: { kind: "human" } }),
  say("assistant", [{ type: "text", text: "Welcome." }])
];

describe("conversationTurns", () => {
  it("keeps prompts and text replies only", () => {
    assert.deepEqual(conversationTurns(messages).map((turn) => `${turn.role}: ${turn.text}`), ["user: Fix the bug", "assistant: Looking.", "assistant: Fixed.", "user: Thanks", "assistant: Welcome."]);
  });

  it("shows slash commands as typed", () => {
    assert.equal(cleanUserText("<command-name>/foo</command-name><command-args>bar</command-args>"), "/foo bar");
  });
});

describe("nthLatestReply and parseReplyIndex", () => {
  const turns = conversationTurns(messages);
  it("counts replies back from the latest", () => {
    assert.equal(nthLatestReply(turns, 1), "Welcome.");
    assert.equal(nthLatestReply(turns, 2), "Fixed.");
    assert.equal(nthLatestReply(turns, 4), undefined);
  });

  it("parses the index", () => {
    assert.equal(parseReplyIndex(""), 1);
    assert.equal(parseReplyIndex("3"), 3);
    assert.equal(parseReplyIndex("0"), undefined);
    assert.equal(parseReplyIndex("x"), undefined);
  });
});

describe("conversationMarkdown", () => {
  it("heads each side once per run", () => {
    assert.equal(conversationMarkdown("Chat", conversationTurns(messages).slice(0, 3)), "# Chat\n\n## You\n\nFix the bug\n\n## Claude\n\nLooking.\n\nFixed.\n");
  });
});
