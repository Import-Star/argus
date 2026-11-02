const USER_NOISE = /^<(local-command-caveat|local-command-stdout|task-notification|system-reminder|command-message)\b/;

export function cleanUserText(raw: string): string {
  const text = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  const command = /<command-name>([\s\S]*?)<\/command-name>(?:[\s\S]*?<command-args>([\s\S]*?)<\/command-args>)?/.exec(text);
  // Argus sends /rename itself to keep the session name in step with the title.
  if (command?.[1].trim() === "/rename") {
    return "";
  }
  if (command) {
    return `${command[1].trim()} ${(command[2] ?? "").trim()}`.trim();
  }
  return USER_NOISE.test(text) ? "" : text;
}

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

interface Entry {
  type: string;
  parent_tool_use_id?: string | null;
  isSynthetic?: boolean;
  isMeta?: boolean;
  origin?: { kind?: string };
  message?: { content?: unknown };
}

function textOf(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  const parts = Array.isArray(content) ? (content as { type?: string; text?: unknown }[]) : [];
  return parts.filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
}

// Typed prompts and Claude's text replies, in order. Tool calls, thinking and injected context are left out.
export function conversationTurns(messages: readonly unknown[]): Turn[] {
  const turns: Turn[] = [];
  for (const entry of messages as Entry[]) {
    if (entry.parent_tool_use_id || (entry.type !== "user" && entry.type !== "assistant")) {
      continue;
    }
    if (entry.type === "user" && (entry.isSynthetic || entry.isMeta || (entry.origin && entry.origin.kind !== "human"))) {
      continue;
    }
    const raw = textOf(entry.message?.content);
    const text = entry.type === "user" ? cleanUserText(raw) : raw.trim();
    if (text && !raw.startsWith("[Request interrupted")) {
      turns.push({ role: entry.type, text });
    }
  }
  return turns;
}

// n = 1 is the latest reply.
export function nthLatestReply(turns: readonly Turn[], n: number): string | undefined {
  return turns.filter((turn) => turn.role === "assistant").reverse()[n - 1]?.text;
}

export function conversationMarkdown(title: string, turns: readonly Turn[]): string {
  const sections = [`# ${title}`];
  turns.forEach((turn, index) => {
    const heading = turn.role === "user" ? "## You" : "## Claude";
    sections.push(turns[index - 1]?.role === turn.role && turn.role === "assistant" ? turn.text : `${heading}\n\n${turn.text}`);
  });
  return `${sections.join("\n\n")}\n`;
}

// "/copy 2" is the second-latest reply; anything else is not understood.
export function parseReplyIndex(args: string): number | undefined {
  if (!args) {
    return 1;
  }
  return /^[1-9]\d*$/.test(args) ? Number(args) : undefined;
}
