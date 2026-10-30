import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { AsideAnswer } from "../src/chat/asideAnswer.ts";

function result(fields: Partial<{ subtype: string; result: string; is_error: boolean; num_turns: number }>): SDKResultMessage {
  return { type: "result", subtype: "success", result: "", is_error: false, num_turns: 1, ...fields } as unknown as SDKResultMessage;
}

function assistant(text: string, parent: string | null = null): SDKMessage {
  return { type: "assistant", parent_tool_use_id: parent, message: { content: [{ type: "thinking", thinking: "" }, { type: "text", text }] } } as unknown as SDKMessage;
}

function delta(text: string): SDKMessage {
  return { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } } as unknown as SDKMessage;
}

describe("AsideAnswer", () => {
  it("skips the empty zero-turn result a resumed session replays before the question's turn", () => {
    const answer = new AsideAnswer();
    assert.equal(answer.finish(result({ num_turns: 0 })), "skip");
    answer.apply(assistant("Needed in M3."));
    assert.deepEqual(answer.finish(result({ num_turns: 2, result: "Needed in M3." })), { status: "done" });
    assert.equal(answer.text, "Needed in M3.");
  });

  it("does not skip a zero-turn result once text has arrived", () => {
    const answer = new AsideAnswer();
    answer.apply(assistant("Partial answer"));
    assert.deepEqual(answer.finish(result({ num_turns: 0 })), { status: "done" });
    assert.equal(answer.text, "Partial answer");
  });

  it("does not skip zero-turn errors", () => {
    assert.deepEqual(new AsideAnswer().finish(result({ num_turns: 0, is_error: true })), { status: "error", error: "The side question ended early (success)." });
    assert.deepEqual(new AsideAnswer().finish(result({ subtype: "error_during_execution", num_turns: 0 })), {
      status: "error",
      error: "The side question ended early (error_during_execution)."
    });
  });

  it("falls back to the result text when no assistant text was seen", () => {
    const answer = new AsideAnswer();
    assert.deepEqual(answer.finish(result({ result: "From the result" })), { status: "done" });
    assert.equal(answer.text, "From the result");
  });

  it("reports running out of turns as an error", () => {
    assert.deepEqual(new AsideAnswer().finish(result({ subtype: "error_max_turns", num_turns: 6 })), {
      status: "error",
      error: "The side question ended early (error_max_turns)."
    });
  });

  it("streams deltas, then replaces them with the whole message", () => {
    const answer = new AsideAnswer();
    assert.equal(answer.apply(delta("Hel")), true);
    answer.apply(delta("lo"));
    assert.equal(answer.text, "Hello");
    answer.apply(assistant("Hello"));
    assert.equal(answer.text, "Hello");
  });

  it("ignores subagent output", () => {
    const answer = new AsideAnswer();
    assert.equal(answer.apply(assistant("from a subagent", "toolu_1")), false);
    assert.equal(answer.text, "");
  });
});
