import type { SDKMessage } from "../../src/chat/protocol";

export type PlanBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; text: string }
  | { kind: "para"; text: string };

export interface InlinePart {
  text: string;
  code?: boolean;
  bold?: boolean;
}

export interface PlanComment {
  id: number;
  block: number;
  quote: string;
  text: string;
}

export interface AskQuestion {
  question: string;
  header: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
}

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;

export function parsePlan(markdown: string): PlanBlock[] {
  const blocks: PlanBlock[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length > 0) {
      blocks.push({ kind: "para", text: para.join(" ") });
      para = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = LIST_ITEM.exec(line);
    if (line.trimStart().startsWith("```")) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !lines[i].trimStart().startsWith("```")) {
        code.push(lines[i]);
      }
      blocks.push({ kind: "code", text: code.join("\n") });
    } else if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
    } else if (item) {
      flush();
      const ordered = /\d/.test(item[1]);
      const last = blocks[blocks.length - 1];
      if (last?.kind === "list" && last.ordered === ordered) {
        last.items.push(item[2]);
      } else {
        blocks.push({ kind: "list", ordered, items: [item[2]] });
      }
    } else if (line.trim() === "") {
      flush();
    } else if (/^\s+\S/.test(line) && blocks[blocks.length - 1]?.kind === "list" && para.length === 0) {
      const last = blocks[blocks.length - 1] as Extract<PlanBlock, { kind: "list" }>;
      last.items[last.items.length - 1] += ` ${line.trim()}`;
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return blocks;
}

export function inlineParts(text: string): InlinePart[] {
  return text
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/)
    .filter((part) => part !== "")
    .map((part) => {
      if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
        return { text: part.slice(1, -1), code: true };
      }
      if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
        return { text: part.slice(2, -2), bold: true };
      }
      return { text: part };
    });
}

export function planComments(comments: PlanComment[]): string {
  const lines = comments.map((comment, index) => `${index + 1}. On "${comment.quote}":\n   ${comment.text}`);
  return `The user wants changes to the plan. Revise it for these comments, then call ExitPlanMode again.\n\n${lines.join("\n\n")}`;
}

export function lastPlan(messages: SDKMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.type !== "assistant") {
      continue;
    }
    for (const block of [...message.message.content].reverse()) {
      if (block.type === "tool_use" && block.name === "ExitPlanMode") {
        const plan = (block.input as { plan?: unknown }).plan;
        return typeof plan === "string" ? plan : undefined;
      }
    }
  }
  return undefined;
}

export function questionsOf(input: Record<string, unknown>): AskQuestion[] {
  return Array.isArray(input.questions) ? (input.questions as AskQuestion[]) : [];
}
