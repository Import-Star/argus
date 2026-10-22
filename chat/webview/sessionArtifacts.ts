import type { SDKMessage } from "../../src/chat/protocol";

export interface SessionArtifact {
  url: string;
  id: string;
  title: string;
}

const ARTIFACT_URL = /https:\/\/claude\.ai\/(?:code\/)?artifact\/([\w-]+)/;

function resultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  return Array.isArray(content) ? content.map((part) => (part && typeof part.text === "string" ? part.text : "")).join("\n") : "";
}

// Artifacts the session published or updated, deduped by URL (latest title wins). Failed publishes don't count.
export function sessionArtifacts(messages: SDKMessage[]): SessionArtifact[] {
  const publishes = new Map<string, { url?: string; title: string }>();
  const found = new Map<string, SessionArtifact>();
  for (const message of messages) {
    const content = message.type === "assistant" || message.type === "user" ? message.message.content : undefined;
    for (const block of Array.isArray(content) ? content : []) {
      if (block.type === "tool_use" && block.name === "Artifact") {
        const input = block.input as { action?: string; asset?: boolean; url?: string; title?: string; file_path?: string };
        if ((input.action ?? "publish") === "publish" && !input.asset) {
          const title = input.title || input.file_path?.split("/").pop() || "Artifact";
          publishes.set(block.id, { url: input.url, title });
        }
      } else if (block.type === "tool_result" && !block.is_error) {
        const publish = publishes.get(block.tool_use_id);
        const match = publish && (resultText(block.content).match(ARTIFACT_URL) ?? publish.url?.match(ARTIFACT_URL));
        if (publish && match) {
          found.set(match[0], { url: match[0], id: match[1], title: publish.title });
        }
      }
    }
  }
  return [...found.values()];
}
