import * as vscode from "vscode";
import type { ChatLoader } from "../chat/loader";

export function registerDiffReview(context: vscode.ExtensionContext, chat: ChatLoader): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("argus.diffReview.open", (sessionId: string, target: { worktree?: string; prUrl?: string }) => chat.host?.review(sessionId, target))
  );
}
