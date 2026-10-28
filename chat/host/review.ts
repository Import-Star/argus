import { readFileSync } from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { REVIEW_PROMPT_START, type ChangeScope, type DiffComment, type FileChange, type FileDiff } from "../../src/chat/protocol";
import { fileLines, loadDiff, type DiffFile } from "../../src/diffReview/git";
import { loadPrDiff, prFileLines } from "../../src/diffReview/pr";
import type { ChatSession } from "./ChatSession";
import { withGaps } from "./diffGaps";

type PrRef = NonNullable<Awaited<ReturnType<typeof loadPrDiff>>["pr"]>;
const posix = (file: string) => file.split(path.sep).join("/");

async function loadScope(session: ChatSession, scope: ChangeScope, edited: string[] = [], prUrl?: string, worktree?: string, reuse = false): Promise<{ base?: string; files: DiffFile[]; pr?: PrRef }> {
  const cwd = worktree ?? session.meta.cwd;
  if (scope === "pr") {
    const result = await loadPrDiff(session.meta.cwd, prUrl ?? "", reuse);
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

export async function fileDiff(session: ChatSession, scope: ChangeScope, file: string, edited?: string[], prUrl?: string, worktree?: string): Promise<FileDiff> {
  const { files, pr } = await loadScope(session, scope, edited, prUrl, worktree, true);
  const found = files.find((candidate) => candidate.path === file);
  if (!found) {
    return { path: file, lines: [] };
  }
  const source = pr ? prFileLines(session.meta.cwd, pr, found.path) : fileLines(worktree ?? session.meta.cwd, "unstaged", found.path);
  const content = found.status === "deleted" ? [] : await source.catch(() => [] as string[]);
  return { path: file, lines: withGaps(found.hunks, content) };
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
