import * as path from "path";
import * as vscode from "vscode";
import { SessionChipsRegistry } from "../api";
import type { ChatLoader } from "../chat/loader";

// Diffs open in the chat's review panel, so the chips show once Argus chat has loaded.
export function registerDiffReview(context: vscode.ExtensionContext, chipsRegistry: SessionChipsRegistry, chat: ChatLoader): void {
  const chips = chipsRegistry.register((card) =>
    card.column === "archived" || !chat.host
      ? undefined
      : [
          ...(card.record.worktrees ?? []).map((folder) => ({
            text: `± ${path.basename(folder)}`,
            tooltip: `Review the diff of ${folder} against its base branch`,
            command: { command: "argus.diffReview.open", arguments: [card.record.sessionId, { worktree: folder }] }
          })),
          ...card.prs
            .filter((pr) => pr.state === "OPEN")
            .map((pr) => ({
              text: `± #${pr.key.split("#").pop()}`,
              tooltip: `Review the diff of ${pr.url}`,
              command: { command: "argus.diffReview.open", arguments: [card.record.sessionId, { prUrl: pr.url }] }
            }))
        ]
  );

  context.subscriptions.push(
    chips,
    vscode.commands.registerCommand("argus.diffReview.open", (sessionId: string, target: { worktree?: string; prUrl?: string }) => chat.host?.review(sessionId, target))
  );
}
