import * as vscode from "vscode";
import { formatElapsed, SessionStore } from "../services/SessionStore";
import { SessionCard } from "../types";
import { stateLabel } from "./SessionTreeProvider";

export class AttentionStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
  private readonly disposables: vscode.Disposable[] = [];
  private readonly tick: NodeJS.Timeout;

  public constructor(private readonly store: SessionStore) {
    this.item.command = "argus.sessions.showAttention";
    this.disposables.push(store.onDidChange(() => this.render()));
    this.tick = setInterval(() => this.render(), 30_000);
    this.render();
    this.item.show();
  }

  public async showPicker(open: (card: SessionCard) => Promise<void>): Promise<void> {
    const cards = this.store.needsYou();
    if (cards.length === 0) {
      void vscode.window.showInformationMessage("No Claude Code sessions are waiting on you.");
      return;
    }
    const picked = await vscode.window.showQuickPick(
      cards.map((card) => ({
        label: `$(bell-dot) ${card.record.title ?? "New chat"}`,
        description: `${card.repo} · ${stateLabel(card)} ${formatElapsed(card.record.stateSince)}`,
        detail: card.record.pending ?? card.record.lastMessage,
        card
      })),
      { title: "Sessions needing you", matchOnDescription: true, matchOnDetail: true }
    );
    if (picked) {
      await open(picked.card);
    }
  }

  public dispose(): void {
    clearInterval(this.tick);
    this.item.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private render(): void {
    const waiting = this.store.needsYou();
    const working = this.store.getCards().filter((card) => card.column === "working").length;
    if (waiting.length === 0) {
      this.item.text = `$(telescope) ${working} working`;
      this.item.backgroundColor = undefined;
      this.item.tooltip = "Argus: no sessions waiting on you";
      return;
    }
    const oldest = waiting[0];
    this.item.text = `$(bell-dot) ${waiting.length} need you · oldest ${formatElapsed(oldest.record.stateSince)}`;
    this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    this.item.tooltip = waiting.map((card) => `${card.record.title ?? "New chat"} — ${stateLabel(card)}`).join("\n");
  }
}
