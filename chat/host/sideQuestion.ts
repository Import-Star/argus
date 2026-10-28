import { query, type Query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type * as vscode from "vscode";
import type { EffortLevel, HostMessage } from "../../src/chat/protocol";
import { hasTranscript } from "./restore";

export interface SideQuestionOptions {
  sessionId: string;
  cwd: string;
  claudePath?: string;
  additionalDirectories: string[];
  log(line: string): void;
  emit(message: Extract<HostMessage, { type: "aside" }>): void;
}

const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"];
const MAX_TURNS = 6;
const FLUSH_MS = 40;
const EFFORT: EffortLevel = "low";
const INSTRUCTIONS =
  "The user is asking a quick side question about this conversation. Answer briefly from what is already in the conversation, using the read-only tools only if you must. Make no changes and do not carry on the earlier task.";

function textOf(content: unknown): string {
  const blocks = Array.isArray(content) ? (content as { type: string; text?: string }[]) : [];
  return blocks.filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
}

export class SideQuestion implements vscode.Disposable {
  private current?: { q: Query; abort: AbortController };

  constructor(private readonly options: SideQuestionOptions) {}

  public ask(askId: string, text: string, model?: string): void {
    this.stop();
    const abort = new AbortController();
    const q = this.open(text, model, abort);
    this.current = { q, abort };
    void this.pump(q, askId, abort);
  }

  public dispose(): void {
    this.stop();
  }

  private stop(): void {
    this.current?.abort.abort();
    this.current?.q.close();
    this.current = undefined;
  }

  // The fork is never persisted, so the main transcript and the board never see it.
  private open(text: string, model: string | undefined, abortController: AbortController): Query {
    const { sessionId, cwd, claudePath, additionalDirectories, log } = this.options;
    const fork = hasTranscript(sessionId);
    return query({
      prompt: text,
      options: {
        cwd,
        additionalDirectories,
        resume: fork ? sessionId : undefined,
        forkSession: fork,
        persistSession: false,
        model: model && model !== "default" ? model : undefined,
        effort: EFFORT,
        maxTurns: MAX_TURNS,
        tools: READ_ONLY_TOOLS,
        systemPrompt: { type: "preset", preset: "claude_code", append: INSTRUCTIONS },
        settings: { disableAllHooks: true },
        abortController,
        pathToClaudeCodeExecutable: claudePath,
        includePartialMessages: true,
        canUseTool: async (toolName, input) =>
          READ_ONLY_TOOLS.includes(toolName) ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: "Side questions are read-only." },
        stderr: (data) => log(`[aside ${sessionId}] ${data.trimEnd()}`)
      }
    });
  }

  private async pump(q: Query, askId: string, abort: AbortController): Promise<void> {
    const { sessionId, log, emit } = this.options;
    const answer = new Answer();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = (status: "streaming" | "done" | "error", error?: string) => {
      clearTimeout(timer);
      timer = undefined;
      emit({ type: "aside", sessionId, askId, text: answer.text, status, error });
    };
    try {
      for await (const message of q) {
        if (abort.signal.aborted) {
          return;
        }
        if (message.type === "result") {
          const failed = message.subtype !== "success" || message.is_error;
          answer.commit(message.subtype === "success" && !answer.text ? message.result : "");
          send(failed ? "error" : "done", failed ? `The side question ended early (${message.subtype}).` : undefined);
          return;
        }
        if (answer.apply(message)) {
          timer ??= setTimeout(() => send("streaming"), FLUSH_MS);
        }
      }
      send("done");
    } catch (error) {
      clearTimeout(timer);
      if (!abort.signal.aborted) {
        const text = error instanceof Error ? error.message : String(error);
        log(`aside ${sessionId}: ${text}`);
        send("error", text);
      }
    } finally {
      if (this.current?.q === q) {
        q.close();
        this.current = undefined;
      }
    }
  }
}

class Answer {
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
}
