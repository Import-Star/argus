import * as path from "path";
import * as vscode from "vscode";
import { SessionChipsRegistry } from "../api";
import { SessionStore } from "../services/SessionStore";
import { DiffPanel } from "./DiffPanel";

export function registerDiffReview(context: vscode.ExtensionContext, sessions: SessionStore, chipsRegistry: SessionChipsRegistry): void {
  const chips = chipsRegistry.register((card) =>
    card.column === "archived"
      ? undefined
      : [
          ...(card.record.worktrees ?? []).map((folder) => ({
            text: `± ${path.basename(folder)}`,
            tooltip: `Review the diff of ${folder} against its base branch`,
            command: { command: "argus.diffReview.open", arguments: [folder, card.record.sessionId] }
          })),
          ...card.prs
            .filter((pr) => pr.state === "OPEN")
            .map((pr) => ({
              text: `± #${pr.key.split("#").pop()}`,
              tooltip: `Review the diff of ${pr.url}`,
              command: { command: "argus.diffReview.open", arguments: [card.record.worktrees?.[0] ?? card.record.cwd, card.record.sessionId, pr.url] }
            }))
        ]
  );

  context.subscriptions.push(
    chips,
    { dispose: () => DiffPanel.disposeAll() },
    vscode.commands.registerCommand("argus.diffReview.open", (folder: string, sessionId?: string, pr?: string) =>
      DiffPanel.show(context, folder, sessionId, pr)
    ),
    vscode.commands.registerCommand("argus.diffReview.pick", async () => {
      const items = sessions
        .getCards()
        .filter((card) => card.column !== "archived")
        .flatMap((card) =>
          (card.record.worktrees ?? []).map((folder) => ({
            label: path.basename(folder),
            description: card.record.title,
            detail: folder,
            folder,
            sessionId: card.record.sessionId
          }))
        );
      for (const workspace of vscode.workspace.workspaceFolders ?? []) {
        items.push({ label: workspace.name, description: "workspace folder", detail: workspace.uri.fsPath, folder: workspace.uri.fsPath, sessionId: "" });
      }
      const pick = await vscode.window.showQuickPick(items, { placeHolder: "Worktree to review" });
      if (pick) {
        DiffPanel.show(context, pick.folder, pick.sessionId || undefined);
      }
    })
  );
}
