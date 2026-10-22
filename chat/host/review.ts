import { readFileSync } from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { REVIEW_PROMPT_START, type ChangeScope, type DiffComment, type DiffLine, type FileChange, type FileDiff } from "../../src/chat/protocol";
import { fileLines, loadDiff, type DiffFile } from "../../src/diffReview/git";
import { loadPrDiff, prFileLines } from "../../src/diffReview/pr";
import type { ChatSession } from "./ChatSession";

type PrRef = NonNullable<Awaited<ReturnType<typeof loadPrDiff>>["pr"]>;
const posix = (file: string) => file.split(path.sep).join("/");

async function loadScope(session: ChatSession, scope: ChangeScope, edited: string[] = [], prUrl?: string, worktree?: string): Promise<{ base?: string; files: DiffFile[]; pr?: PrRef }> {
  const cwd = worktree ?? session.meta.cwd;
  if (scope === "pr") {
    const result = await loadPrDiff(session.meta.cwd, prUrl ?? "");
    return { base: result.base, files: result.files, pr: result.pr };
  }
  const config = vscode.workspace.getConfiguration("argus.diffReview");
  const contextLines = config.get<number>("contextLines", 3);
  const baseRef = scope === "base" || scope === "session" ? config.get<string>("baseRef", "") : "HEAD";
  const result = await loadDiff(cwd, "all", baseRef, contextLines);
  const base = scope === "base" || scope === "session" ? result.base : undefined;
  if (scope === "base" || scope === "uncommitted") {
    return { base, files: result.files };
  }
  const touched = (scope === "turn" ? session.lastTurnFiles() : edited.map((file) => path.resolve(cwd, file))).map(posix);
  return { base, files: result.files.filter((file) => touched.some((abs) => abs.endsWith(`/${file.path}`))) };
}

export async function listChanges(session: ChatSession, scope: ChangeScope, edited?: string[], prUrl?: string, worktree?: string): Promise<{ base?: string; files: FileChange[]; error?: string }> {
  try {
    const { base, files } = await loadScope(session, scope, edited, prUrl, worktree);
    const changes = files.map((file) => ({
      path: file.path,
      added: file.additions,
      removed: file.deletions,
      status: file.status
    }));
    return { base, files: changes };
  } catch (error) {
    return { files: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function gap(count: number): DiffLine[] {
  return count > 0 ? [{ kind: "gap", text: `${count} unchanged ${count === 1 ? "line" : "lines"}` }] : [];
}

function hunkRange(header: string): { start: number; end: number } {
  const match = header.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
  const count = match?.[2] === undefined ? 1 : Number(match[2]);
  const start = Number(match?.[1] ?? 1) + (count === 0 ? 1 : 0);
  return { start, end: start + count - 1 };
}

export async function fileDiff(session: ChatSession, scope: ChangeScope, file: string, edited?: string[], prUrl?: string, worktree?: string): Promise<FileDiff> {
  const { files, pr } = await loadScope(session, scope, edited, prUrl, worktree);
  const found = files.find((candidate) => candidate.path === file);
  if (!found) {
    return { path: file, lines: [] };
  }
  const lines: DiffLine[] = [];
  let previousEnd = 0;
  for (const hunk of found.hunks) {
    const range = hunkRange(hunk.header);
    lines.push(...gap(range.start - previousEnd - 1));
    lines.push(...hunk.lines.map((line) => ({ kind: line.type, oldNo: line.old, newNo: line.new, text: line.text })));
    previousEnd = range.end;
  }
  const source = pr ? prFileLines(session.meta.cwd, pr.repo, pr.headSha, found.path) : fileLines(worktree ?? session.meta.cwd, "unstaged", found.path);
  const total = found.status === "deleted" ? 0 : await source.then((content) => content.length, () => 0);
  lines.push(...gap(total - previousEnd));
  return { path: file, lines };
}

function lineText(cwd: string, file: string, line: number): string | undefined {
  try {
    return readFileSync(path.resolve(cwd, file), "utf8").split("\n")[line - 1];
  } catch {
    return undefined;
  }
}

export function commentsPrompt(comments: DiffComment[], cwd?: string): string {
  const blocks = comments.map((comment) => {
    const deleted = comment.side === "old";
    const code = comment.code ?? (!deleted && cwd ? lineText(cwd, comment.path, comment.line) : undefined);
    const where = `${comment.path}:${comment.line}${deleted ? " (deleted line, old file numbering)" : ""}`;
    return [`Comment ${comment.id}: ${where}`, ...(code === undefined ? [] : [`    ${code.trim()}`]), comment.text].join("\n");
  });
  const ids = comments.map((comment) => `"Comment ${comment.id}:"`).join(", ");
  return [
    `${REVIEW_PROMPT_START} Address each one, then say what you changed.`,
    `Start your answer to each comment with a line that is exactly ${ids} (one per comment, in that form), followed by your answer for it.`,
    ...blocks
  ].join("\n\n");
}
