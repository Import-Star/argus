import type { PermissionRequest } from "./protocol";

export interface WireQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: { label: string; description: string }[];
}

export interface WirePending {
  id: string;
  toolName: string;
  summary: string;
  alwaysLabel?: string;
  questions?: WireQuestion[];
}

const MAX_SUMMARY = 240;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function questionsOf(input: Record<string, unknown>): WireQuestion[] {
  const raw = Array.isArray(input.questions) ? (input.questions as Record<string, unknown>[]) : [];
  return raw.map((entry) => ({
    question: text(entry.question),
    header: text(entry.header),
    multiSelect: entry.multiSelect === true,
    options: (Array.isArray(entry.options) ? (entry.options as Record<string, unknown>[]) : []).map((option) => ({
      label: text(option.label),
      description: text(option.description)
    }))
  }));
}

export function summarize(request: PermissionRequest): string {
  const input = request.input;
  if (request.toolName === "AskUserQuestion") {
    return questionsOf(input)[0]?.question ?? "";
  }
  if (request.toolName === "ExitPlanMode") {
    return "Plan ready for approval";
  }
  const summary = text(input.command) || text(input.file_path) || text(input.notebook_path) || text(input.path) || text(input.url) || text(input.pattern) || request.blockedPath || "";
  return summary.length > MAX_SUMMARY ? `${summary.slice(0, MAX_SUMMARY)}…` : summary;
}

export function toWirePending(request: PermissionRequest): WirePending {
  return {
    id: request.id,
    toolName: request.toolName,
    summary: summarize(request),
    alwaysLabel: request.alwaysLabel,
    questions: request.toolName === "AskUserQuestion" ? questionsOf(request.input) : undefined
  };
}

// Answers keyed by question text, as the AskUserQuestion tool expects; unknown questions are dropped.
export function answeredInput(input: Record<string, unknown>, answers: unknown): Record<string, unknown> | undefined {
  if (!answers || typeof answers !== "object") {
    return undefined;
  }
  const known = new Set(questionsOf(input).map((entry) => entry.question));
  const clean: Record<string, string> = {};
  for (const [question, answer] of Object.entries(answers as Record<string, unknown>)) {
    if (known.has(question) && typeof answer === "string" && answer) {
      clean[question] = answer;
    }
  }
  return Object.keys(clean).length === known.size ? { ...input, answers: clean } : undefined;
}
