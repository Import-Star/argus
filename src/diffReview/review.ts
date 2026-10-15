import type { DiffResult } from "./git";

export interface ReviewComment {
  id: string;
  path: string;
  side: "old" | "new";
  line: number;
  label: string;
  excerpt: string[];
  body: string;
}

export interface Draft {
  comments: ReviewComment[];
  note: string;
}

export function formatReview(result: Pick<DiffResult, "branch" | "base" | "folder" | "pr">, draft: Draft): string {
  const subject = result.pr
    ? `PR #${result.pr.number} ${result.pr.url} (\`${result.branch}\` into \`${result.base}\`)`
    : `\`${result.branch}\` (diff against \`${result.base}\`, worktree ${result.folder})`;
  const parts = [`Review feedback on ${subject}. Address each comment:`];
  if (draft.note.trim()) {
    parts.push(`## General\n\n${draft.note.trim()}`);
  }
  for (const comment of draft.comments) {
    parts.push(`## ${comment.path}:${comment.label}\n\n\`\`\`diff\n${comment.excerpt.join("\n")}\n\`\`\`\n\n${comment.body.trim()}`);
  }
  return parts.join("\n\n");
}
