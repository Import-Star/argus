import * as vscode from "vscode";
import { SessionStore } from "../services/SessionStore";
import { SessionCard } from "../types";

type Mode = "all" | "input" | "off";

// Shows a VS Code notification when a session in this window's scope starts waiting on the user, with a button that
// opens its Claude Code tab. Sessions already waiting when the window opens are not announced.
export class AttentionNotifier implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly seen = new Set<string>();
  private seeded = false;

  public constructor(private readonly store: SessionStore) {
    this.disposables.push(store.onDidChange((cards) => this.check(cards)));
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private check(cards: readonly SessionCard[]): void {
    const waiting = cards.filter((card) => card.column === "needs-you");
    const fresh = waiting.filter((card) => !this.seen.has(keyOf(card)));
    for (const card of fresh) {
      this.seen.add(keyOf(card));
    }
    if (!this.seeded) {
      this.seeded = true;
      return;
    }
    const mode = vscode.workspace.getConfiguration("argus").get<Mode>("notifications", "all");
    for (const card of fresh) {
      const input = card.record.state === "permission" || card.record.state === "question";
      if (mode === "off" || (mode === "input" && !input)) {
        continue;
      }
      void this.notify(card, input);
    }
  }

  private async notify(card: SessionCard, input: boolean): Promise<void> {
    const title = card.record.title ?? "New chat";
    const what =
      card.record.state === "permission"
        ? `needs permission${card.record.pending ? `: ${card.record.pending}` : ""}`
        : card.record.state === "question"
          ? `has a question${card.record.pending ? `: ${card.record.pending}` : ""}`
          : "has finished";
    const message = `Argus: "${title}" ${what}`;
    const show = input ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    const choice = await show(message, "Open Session");
    if (choice) {
      // Look the card up again: the notification may have sat in the notification centre for a while.
      const current = this.store.getCards().find((candidate) => candidate.record.sessionId === card.record.sessionId) ?? card;
      await vscode.commands.executeCommand("argus.sessions.open", current);
    }
  }
}

function keyOf(card: SessionCard): string {
  return `${card.record.sessionId}:${card.record.state}:${card.record.stateSince}`;
}
