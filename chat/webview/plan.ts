import type { SDKMessage } from "../../src/chat/protocol";

export interface PlanComment {
  id: number;
  quote: string;
  text: string;
}

export interface AskQuestion {
  question: string;
  header: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
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

export const RECOMMENDED = /\s*\(recommended\)\s*$/i;

export function questionsOf(input: Record<string, unknown>): AskQuestion[] {
  return Array.isArray(input.questions) ? (input.questions as AskQuestion[]) : [];
}
