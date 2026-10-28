import { forkSession, getSessionMessages, type RewindFilesResult } from "@anthropic-ai/claude-agent-sdk";
import * as path from "path";
import * as vscode from "vscode";
import type { ChatSession } from "./ChatSession";

const MAX_LISTED = 8;
const NOT_UNDONE = "Changes made by Bash commands, and edits you made yourself, are not undone.";

export interface RewindRequest {
  userMessageId: string;
  text: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// The transcript's own order decides what comes before a message: queued messages land mid-turn, not where the transcript view shows them.
async function keepPoint(session: ChatSession, messageId: string, before: boolean): Promise<string> {
  const chain = await getSessionMessages(session.sessionId, { dir: session.meta.cwd });
  const at = chain.findIndex((entry) => entry.uuid === messageId);
  const keep = at < 0 ? undefined : before ? chain[at - 1]?.uuid : messageId;
  if (!keep) {
    throw new Error(at < 0 ? "that message isn't in the saved conversation yet" : "there is nothing before the first message to keep");
  }
  return keep;
}

function fileSummary(preview: RewindFilesResult, cwd: string): string {
  if (!preview.canRewind) {
    return `Files can't be restored${preview.error ? ` (${preview.error})` : ""}. Only the conversation is rewound.`;
  }
  const files = (preview.filesChanged ?? []).map((file) => path.relative(cwd, file) || file);
  if (files.length === 0) {
    return "No tracked files changed since this message.";
  }
  const listed = files.slice(0, MAX_LISTED).join(", ");
  const more = files.length > MAX_LISTED ? ` and ${files.length - MAX_LISTED} more` : "";
  return `Restores ${files.length} ${files.length === 1 ? "file" : "files"} to their state before this message (+${preview.insertions ?? 0} −${preview.deletions ?? 0} lines): ${listed}${more}.`;
}

export async function rewind(session: ChatSession, request: RewindRequest): Promise<void> {
  if (session.meta.status === "working" || session.meta.status === "needs-you") {
    void vscode.window.showWarningMessage("Argus: stop the agent before rewinding.");
    return;
  }
  const keepAt = await keepPoint(session, request.userMessageId, true);
  const preview = await session.rewindFiles(request.userMessageId, true).catch((error): RewindFilesResult => ({ canRewind: false, error: errorText(error) }));
  const detail = [
    fileSummary(preview, session.meta.cwd),
    "Everything from this message on is removed from the conversation, and the message goes back into the composer.",
    NOT_UNDONE
  ].join("\n\n");
  const action = preview.canRewind ? "Rewind" : "Rewind Conversation";
  if (!(await vscode.window.showWarningMessage("Rewind to before this message?", { modal: true, detail }, action))) {
    return;
  }
  if (preview.canRewind) {
    const done = await session.rewindFiles(request.userMessageId, false);
    if (!done.canRewind) {
      void vscode.window.showErrorMessage(`Argus: couldn't restore files${done.error ? `: ${done.error}` : ""}. The conversation was left as it was.`);
      return;
    }
  }
  await session.truncateTo(keepAt, request.userMessageId, request.text);
}

export async function forkTranscript(session: ChatSession, messageId: string, before: boolean): Promise<string> {
  const upToMessageId = await keepPoint(session, messageId, before);
  const { title } = session.meta;
  return (await forkSession(session.sessionId, { dir: session.meta.cwd, upToMessageId, title: title ? `${title} (fork)` : undefined })).sessionId;
}
