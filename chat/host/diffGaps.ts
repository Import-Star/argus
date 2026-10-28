import type { DiffLine } from "../../src/chat/protocol";
import type { DiffHunk } from "../../src/diffReview/git";

const MAX_GAP_LINES = 2000;

// A file's hunks with the unchanged lines between them as expandable gaps. `content` is the new side of the file.
export function withGaps(hunks: DiffHunk[], content: string[]): DiffLine[] {
  const lines: DiffLine[] = [];
  let previousEnd = 0;
  let offset = 0;
  for (const hunk of hunks) {
    const range = hunkRange(hunk.header);
    lines.push(...gap(previousEnd + 1, range.start - 1, range.offset, content));
    lines.push(...hunk.lines.map((line) => ({ kind: line.type, oldNo: line.old, newNo: line.new, text: line.text })));
    previousEnd = range.end;
    offset = range.after;
  }
  lines.push(...gap(previousEnd + 1, content.length, offset, content));
  return lines;
}

export function gap(from: number, to: number, offset: number, content: string[]): DiffLine[] {
  const count = to - from + 1;
  if (count <= 0) return [];
  const text = `${count} unchanged ${count === 1 ? "line" : "lines"}`;
  if (count > MAX_GAP_LINES || content.length < to) return [{ kind: "gap", text }];
  const lines = content.slice(from - 1, to).map((line, index) => ({ oldNo: from + index + offset, newNo: from + index, text: line }));
  return [{ kind: "gap", text, lines }];
}

// `offset` maps new line numbers to old ones before the hunk, `after` once its added and removed lines are counted.
export function hunkRange(header: string): { start: number; end: number; offset: number; after: number } {
  const match = header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  const oldCount = match?.[2] === undefined ? 1 : Number(match[2]);
  const count = match?.[4] === undefined ? 1 : Number(match[4]);
  const oldStart = Number(match?.[1] ?? 1) + (oldCount === 0 ? 1 : 0);
  const start = Number(match?.[3] ?? 1) + (count === 0 ? 1 : 0);
  return { start, end: start + count - 1, offset: oldStart - start, after: oldStart + oldCount - (start + count) };
}
