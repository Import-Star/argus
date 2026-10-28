import type { DiffComment, SDKMessage } from "../../src/chat/protocol";

export interface ReviewTurn {
  id: string;
  text: string;
  sent: boolean;
}

export interface ReviewThread {
  id: string;
  path: string;
  line: number;
  side: "old" | "new";
  code: string;
  resolved: boolean;
  turns: ReviewTurn[];
}

export interface ReviewBatch {
  ids: string[];
  from: number;
}

export interface ReviewState {
  threads: ReviewThread[];
  batches: ReviewBatch[];
  next: number;
}

export type TurnState = "draft" | "sent" | "answered";

export interface TurnView {
  state: TurnState;
  reply?: string;
  inChat?: boolean;
}

export const EMPTY_REVIEW: ReviewState = { threads: [], batches: [], next: 1 };

const MARKER = /^[ \t#>*_-]*Comment (c\d+):[*_]*[ \t]*/gm;

type Raw = { type?: string; parent_tool_use_id?: string | null; message?: { content?: unknown } };

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n\n");
}

export function splitSections(text: string): Map<string, string> {
  const marks = [...text.matchAll(MARKER)];
  const sections = new Map<string, string>();
  marks.forEach((mark, index) => {
    const end = marks[index + 1]?.index ?? text.length;
    sections.set(mark[1], text.slice(mark.index + mark[0].length, end).trim());
  });
  return sections;
}

// Assistant text after the batch's prompt echo, up to the turn's result message.
export function batchReply(messages: SDKMessage[], batch: ReviewBatch): { done: boolean; text: string } | undefined {
  const raw = messages as Raw[];
  const echo = `Comment ${batch.ids[0]}:`;
  const start = raw.findIndex((message, index) => index >= batch.from && message.type === "user" && textOf(message.message?.content).includes(echo));
  if (start < 0) return undefined;
  const parts: string[] = [];
  for (const message of raw.slice(start + 1)) {
    if (message.type === "result") return { done: true, text: parts.join("\n\n") };
    if (message.type === "assistant" && !message.parent_tool_use_id) parts.push(textOf(message.message?.content));
  }
  return { done: false, text: parts.join("\n\n") };
}

export function deriveTurns(messages: SDKMessage[], review: ReviewState): Map<string, TurnView> {
  const views = new Map<string, TurnView>();
  review.threads.forEach((thread) => thread.turns.forEach((turn) => views.set(turn.id, { state: turn.sent ? "sent" : "draft" })));
  for (const batch of review.batches) {
    const found = batchReply(messages, batch);
    if (!found) continue;
    const sections = splitSections(found.text);
    const order = [...sections.keys()];
    for (const id of batch.ids) {
      const section = sections.get(id);
      const finished = found.done || order.indexOf(id) < order.length - 1;
      if (section !== undefined && finished) views.set(id, { state: "answered", reply: section });
      else if (found.done) views.set(id, { state: "answered", reply: found.text.trim() || "No reply.", inChat: true });
    }
  }
  return views;
}

export function toComment(thread: ReviewThread, turn: ReviewTurn): DiffComment {
  return { id: turn.id, path: thread.path, line: thread.line, side: thread.side, code: thread.code, text: turn.text.trim() };
}

export function counts(threads: ReviewThread[], views: Map<string, TurnView>): { sent: number; answered: number; progress: number; drafts: number } {
  const turns = threads.flatMap((thread) => thread.turns.map((turn) => views.get(turn.id)?.state ?? "draft"));
  const answered = turns.filter((state) => state === "answered").length;
  const progress = turns.filter((state) => state === "sent").length;
  return { sent: answered + progress, answered, progress, drafts: turns.length - answered - progress };
}

const mapThread = (review: ReviewState, id: string, update: (thread: ReviewThread) => ReviewThread): ReviewState => ({
  ...review,
  threads: review.threads.map((thread) => (thread.id === id ? update(thread) : thread))
});

export function addThread(review: ReviewState, anchor: Pick<ReviewThread, "path" | "line" | "side" | "code">): { review: ReviewState; threadId: string } {
  const id = `c${review.next}`;
  const thread: ReviewThread = { ...anchor, id: `t${id}`, resolved: false, turns: [{ id, text: "", sent: false }] };
  return { review: { ...review, next: review.next + 1, threads: [...review.threads, thread] }, threadId: thread.id };
}

export function setDraftText(review: ReviewState, threadId: string, turnId: string, text: string): ReviewState {
  return mapThread(review, threadId, (thread) => ({ ...thread, turns: thread.turns.map((turn) => (turn.id === turnId ? { ...turn, text } : turn)) }));
}

export function removeTurn(review: ReviewState, threadId: string, turnId: string): ReviewState {
  const threads = review.threads
    .map((thread) => (thread.id === threadId ? { ...thread, turns: thread.turns.filter((turn) => turn.id !== turnId) } : thread))
    .filter((thread) => thread.turns.length > 0);
  return { ...review, threads };
}

export function addReply(review: ReviewState, threadId: string, text: string): { review: ReviewState; turn: ReviewTurn } {
  const turn: ReviewTurn = { id: `c${review.next}`, text, sent: false };
  const next = mapThread(review, threadId, (thread) => ({ ...thread, resolved: false, turns: [...thread.turns, turn] }));
  return { review: { ...next, next: review.next + 1 }, turn };
}

export function markSent(review: ReviewState, ids: string[], from: number): ReviewState {
  const threads = review.threads
    .map((thread) => ({
      ...thread,
      turns: thread.turns.filter((turn) => turn.sent || turn.text.trim()).map((turn) => (ids.includes(turn.id) ? { ...turn, sent: true } : turn))
    }))
    .filter((thread) => thread.turns.length > 0);
  return { ...review, threads, batches: [...review.batches, { ids, from }] };
}

export function setResolved(review: ReviewState, threadId: string, resolved: boolean): ReviewState {
  return mapThread(review, threadId, (thread) => ({ ...thread, resolved }));
}

export function draftComments(review: ReviewState): DiffComment[] {
  return review.threads.flatMap((thread) => thread.turns.filter((turn) => !turn.sent && turn.text.trim()).map((turn) => toComment(thread, turn)));
}
