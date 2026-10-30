import type { SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

function textOf(content: unknown): string {
  const blocks = Array.isArray(content) ? (content as { type: string; text?: string }[]) : [];
  return blocks.filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
}

// Collects a side question's answer from streamed deltas and whole assistant messages.
export class AsideAnswer {
  private finished = "";
  private partial = "";

  get text(): string {
    return this.finished && this.partial ? `${this.finished}\n\n${this.partial}` : this.finished || this.partial;
  }

  commit(text: string): void {
    if (text) {
      this.finished = this.finished ? `${this.finished}\n\n${text}` : text;
    }
    this.partial = "";
  }

  apply(message: SDKMessage): boolean {
    if (message.type === "stream_event" && !message.parent_tool_use_id) {
      const { event } = message;
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        this.partial += event.delta.text;
        return true;
      }
    } else if (message.type === "assistant" && !message.parent_tool_use_id) {
      this.commit(textOf(message.message.content));
      return true;
    }
    return false;
  }

  // Resuming a session with queued work (e.g. a finished background task) replays an empty zero-turn
  // result before the question's own turn starts: "skip" it and keep reading. Otherwise the result ends
  // the question.
  finish(result: SDKResultMessage): "skip" | { status: "done" | "error"; error?: string } {
    const success = result.subtype === "success";
    if (success && !result.is_error && result.num_turns === 0 && !result.result && !this.text) {
      return "skip";
    }
    this.commit(success && !this.text ? result.result : "");
    const failed = !success || result.is_error;
    return failed ? { status: "error", error: `The side question ended early (${result.subtype}).` } : { status: "done" };
  }
}
