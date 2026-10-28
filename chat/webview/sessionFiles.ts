import type { SDKMessage } from "../../src/chat/protocol";

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

// Files the session edited that live under cwd, relative to it, in first-edit order. Failed edits don't count.
export function sessionFiles(messages: SDKMessage[], cwd?: string): string[] {
  const edits = new Map<string, string>();
  for (const message of messages) {
    const content = message.type === "assistant" || message.type === "user" ? message.message.content : undefined;
    for (const block of Array.isArray(content) ? content : []) {
      if (block.type === "tool_use" && EDIT_TOOLS.has(block.name)) {
        const input = block.input as { file_path?: unknown; notebook_path?: unknown };
        const file = input.file_path ?? input.notebook_path;
        if (typeof file === "string") {
          edits.set(block.id, file);
        }
      } else if (block.type === "tool_result" && block.is_error) {
        edits.delete(block.tool_use_id);
      }
    }
  }
  const prefix = cwd ? `${cwd.replace(/\/+$/, "")}/` : undefined;
  const files = [...edits.values()].map((file) => (prefix && file.startsWith(prefix) ? file.slice(prefix.length) : file)).filter((file) => !file.startsWith("/") && !file.startsWith("../"));
  return [...new Set(files)];
}
