import type { SDKMessage } from "../../src/chat/protocol";

const ANSI = /\x1b\[[0-9;]*m/g;
const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):\d+[^\s"'<>)\]]*/g;
const LOOPBACK = new Set(["localhost", "127.0.0.1"]);
const MAX_SERVERS = 4;

function resultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  return Array.isArray(content) ? content.map((part) => (part && typeof part.text === "string" ? part.text : "")).join("\n") : "";
}

export function normalizeUrl(input: string): string | undefined {
  const text = input.trim();
  if (!text || /\s/.test(text)) {
    return undefined;
  }
  const candidate = /^\d{2,5}$/.test(text) ? `http://localhost:${text}` : /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `${/^(localhost|127\.0\.0\.1)(:|\/|$)/.test(text) ? "http" : "https"}://${text}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

// Only loopback http is allowed by the webview's frame-src.
export function isFramable(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" && LOOPBACK.has(parsed.hostname);
  } catch {
    return false;
  }
}

function toLocalhost(raw: string): string | undefined {
  const cleaned = raw.replace(/[.,;:]+$/, "").replace(/^(https?:\/\/)(?:0\.0\.0\.0|\[::1?\])/, "$1localhost");
  return normalizeUrl(cleaned);
}

// Dev-server URLs printed by Bash tool results, newest first.
export function devServerUrls(messages: SDKMessage[]): string[] {
  const bashIds = new Set<string>();
  const found: string[] = [];
  for (const message of messages) {
    const content = message.type === "assistant" || message.type === "user" ? message.message.content : undefined;
    for (const block of Array.isArray(content) ? content : []) {
      if (block.type === "tool_use" && block.name === "Bash") {
        bashIds.add(block.id);
      } else if (block.type === "tool_result" && bashIds.has(block.tool_use_id)) {
        const text = resultText(block.content).replace(ANSI, "");
        for (const match of text.match(LOCAL_URL) ?? []) {
          const url = toLocalhost(match);
          if (url) {
            found.push(url);
          }
        }
      }
    }
  }
  return [...new Set(found.reverse())].slice(0, MAX_SERVERS);
}
