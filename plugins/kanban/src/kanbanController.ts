import * as vscode from "vscode";
import type { ArgusApi, CleanupItem, PrSummary, SessionCard, TabHandle } from "../../../api";
import { BoardStore } from "./boardStore";
import { BoardWatcher } from "./boardWatcher";
import { BoardData, Card } from "./types";

function firstLine(text: string, limit: number): string {
  return text.split("\n")[0].slice(0, limit);
}

// Drives the Work tab: owns the board file, the PR sync cache and the session-chip / archive-cleanup
// integrations. The board file is never created implicitly - readBoard/mutate assume it exists, and the
// webview shows an empty state with a "Create board" button that calls createBoard().
export class KanbanController implements vscode.Disposable {
  private readonly store = new BoardStore();
  private readonly watcher = new BoardWatcher();
  private readonly disposables: vscode.Disposable[] = [];

  private handle?: TabHandle;
  private chipsHandle?: vscode.Disposable & { refresh(): void };

  private watchedPath?: string;
  private currentBoardUri?: vscode.Uri;
  private lastBoard?: BoardData;

  private prByCardId: Record<string, PrSummary[]> = {};
  private lastSyncError?: string;
  private prSyncedAt?: number;
  private syncing = false;

  private visible = false;
  private pollTimer?: NodeJS.Timeout;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly api: ArgusApi
  ) {}

  public activate(): void {
    this.handle = this.api.registerTab({
      id: "kanban",
      title: "Work",
      order: 10,
      script: vscode.Uri.joinPath(this.context.extensionUri, "media", "kanban.js"),
      style: vscode.Uri.joinPath(this.context.extensionUri, "media", "kanban.css"),
      onMessage: (message) => this.handleMessage(message),
      onDidChangeVisibility: (visible) => this.handleVisibility(visible)
    });
    this.disposables.push(this.handle);

    this.chipsHandle = this.api.registerSessionChips((card) => this.chipsFor(card));
    this.disposables.push(this.chipsHandle);

    this.disposables.push(this.api.registerArchiveCleanup((card) => this.cleanupFor(card)));

    this.disposables.push(this.api.sessions.onDidChange(() => this.postSessions()));

    this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refreshBoardCache()));
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("argus.kanban.boardFile")) {
          void this.refreshBoardCache();
        }
        if (event.affectsConfiguration("argus.sessions.prRefreshMinutes") && this.pollTimer) {
          this.startPolling();
        }
      })
    );

    void this.refreshBoardCache();
  }

  public async forceRefreshPrs(): Promise<void> {
    if (!this.currentBoardUri) {
      void vscode.window.showInformationMessage("Argus: create a Work board first.");
      return;
    }
    await this.syncPrs(true, false);
  }

  public dispose(): void {
    this.stopPolling();
    this.watcher.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  // ── Webview messages ──────────────────────────────────────────────────────

  private async handleMessage(message: unknown): Promise<void> {
    const m = (message && typeof message === "object" ? message : {}) as Record<string, unknown>;
    const type = typeof m.type === "string" ? m.type : "";

    switch (type) {
      case "ready":
        await this.refreshBoardCache();
        return;
      case "createBoard":
        await this.createBoard();
        return;
      case "addColumn":
        await this.addColumn(this.optionalString(m.name));
        return;
      case "renameColumn":
        await this.renameColumn(this.str(m.columnId), this.optionalString(m.name), this.optionalString(m.currentName));
        return;
      case "removeColumn":
        await this.removeColumn(this.str(m.columnId));
        return;
      case "addCard":
        await this.addCard(this.str(m.columnId), this.optionalString(m.text));
        return;
      case "updateCard":
        await this.updateCard(this.str(m.columnId), this.str(m.cardId), this.optionalString(m.text), this.optionalString(m.currentText));
        return;
      case "removeCard":
        await this.removeCard(this.str(m.columnId), this.str(m.cardId));
        return;
      case "moveCard":
        await this.moveCard(this.str(m.cardId), this.str(m.fromColumnId), this.str(m.toColumnId), Number(m.targetIndex ?? 0));
        return;
      case "refreshPr":
        await this.syncPrs(true, true);
        return;
      case "startAgent":
        await this.startAgent(this.str(m.cardId));
        return;
      default:
        return;
    }
  }

  private str(value: unknown): string {
    return typeof value === "string" ? value : String(value ?? "");
  }

  private optionalString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  // ── Board lifecycle ───────────────────────────────────────────────────────

  private async refreshBoardCache(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      this.teardownWatch();
      this.currentBoardUri = undefined;
      this.lastBoard = undefined;
      this.stopPolling();
      this.post({ type: "noWorkspace" });
      this.chipsHandle?.refresh();
      return;
    }

    const uri = this.store.resolveBoardUri();
    if (!uri) {
      return;
    }

    if (this.watchedPath !== uri.fsPath) {
      this.watchedPath = uri.fsPath;
      this.watcher.watch(uri, () => void this.refreshBoardCache());
    }

    const exists = await this.store.boardExists(uri);
    if (!exists) {
      this.currentBoardUri = undefined;
      this.lastBoard = undefined;
      this.stopPolling();
      this.post({ type: "empty" });
      this.chipsHandle?.refresh();
      return;
    }

    this.currentBoardUri = uri;
    try {
      this.lastBoard = await this.store.readBoard(uri);
      this.postState();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load Work board.";
      this.post({ type: "error", message });
    }
    this.chipsHandle?.refresh();
  }

  private teardownWatch(): void {
    this.watchedPath = undefined;
    this.watcher.dispose();
  }

  private async createBoard(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const uri = this.store.resolveBoardUri();
    if (!uri) {
      return;
    }
    try {
      this.lastBoard = await this.store.createBoard(uri);
      this.currentBoardUri = uri;
      if (this.watchedPath !== uri.fsPath) {
        this.watchedPath = uri.fsPath;
        this.watcher.watch(uri, () => void this.refreshBoardCache());
      }
      this.postState();
      this.chipsHandle?.refresh();
      if (this.visible) {
        await this.syncPrs(false, true);
        this.startPolling();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create Work board.";
      void vscode.window.showErrorMessage(`Argus: ${message}`);
    }
  }

  private handleVisibility(visible: boolean): void {
    this.visible = visible;
    if (visible) {
      void this.onBecomeVisible();
    } else {
      this.stopPolling();
    }
  }

  private async onBecomeVisible(): Promise<void> {
    await this.refreshBoardCache();
    if (this.currentBoardUri) {
      await this.syncPrs(false, true);
      this.startPolling();
    }
  }

  private startPolling(): void {
    this.stopPolling();
    const minutes = Math.max(1, vscode.workspace.getConfiguration("argus").get<number>("sessions.prRefreshMinutes", 5));
    this.pollTimer = setInterval(() => {
      if (this.visible && this.currentBoardUri) {
        void this.syncPrs(true, true);
      }
    }, minutes * 60_000);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  // ── PR sync ────────────────────────────────────────────────────────────────

  private async syncPrs(refresh: boolean, background: boolean): Promise<void> {
    if (!this.currentBoardUri || !this.lastBoard) {
      return;
    }

    this.syncing = true;
    this.post({ type: "syncing", value: true });

    try {
      const board = this.lastBoard;
      const urlsByCard = new Map<string, string[]>();
      const allUrls = new Set<string>();

      for (const column of board.columns) {
        for (const card of column.cards) {
          const urls = this.api.prs.parse(card.text);
          if (urls.length > 0) {
            urlsByCard.set(card.id, urls);
            for (const url of urls) {
              allUrls.add(url);
            }
          }
        }
      }

      if (allUrls.size === 0) {
        this.prByCardId = {};
        this.lastSyncError = undefined;
        this.prSyncedAt = Date.now();
        return;
      }

      const availability = await this.api.prs.available();
      if (!availability.ok) {
        this.lastSyncError = availability.message;
        this.prByCardId = {};
        return;
      }

      const resolved = await this.api.prs.get([...allUrls], { refresh });
      const prByCardId: Record<string, PrSummary[]> = {};
      let lastSyncError: string | undefined;

      for (const [cardId, urls] of urlsByCard) {
        const prs: PrSummary[] = [];
        for (const url of urls) {
          const summary = resolved.get(url);
          if (summary) {
            prs.push(summary);
            if (summary.error) {
              lastSyncError = summary.error;
            }
          }
        }
        prByCardId[cardId] = prs;
      }

      this.prByCardId = prByCardId;
      this.lastSyncError = lastSyncError;
      this.prSyncedAt = Date.now();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to refresh PR status.";
      this.lastSyncError = message;
      if (!background) {
        void vscode.window.showErrorMessage(`Argus: ${message}`);
      }
    } finally {
      this.syncing = false;
      this.post({ type: "syncing", value: false });
      this.postState();
    }
  }

  // ── Board mutations ────────────────────────────────────────────────────────

  private async addColumn(name?: string): Promise<void> {
    if (!this.currentBoardUri) {
      return;
    }
    const resolved = await this.resolveColumnName(name);
    if (resolved === undefined) {
      return;
    }
    await this.mutateAndPost((board) => {
      board.columns.push({ id: this.store.createId("col"), name: resolved, cards: [] });
    });
  }

  private async renameColumn(columnId: string, name?: string, currentName?: string): Promise<void> {
    if (!this.currentBoardUri) {
      return;
    }
    const resolved = await this.resolveColumnName(name, currentName ?? "");
    if (resolved === undefined) {
      return;
    }
    await this.mutateAndPost((board) => {
      const column = board.columns.find((candidate) => candidate.id === columnId);
      if (!column) {
        throw new Error("Column not found.");
      }
      column.name = resolved;
    });
  }

  private async removeColumn(columnId: string): Promise<void> {
    if (!this.currentBoardUri) {
      return;
    }
    const confirmed = await vscode.window.showWarningMessage("Remove this column and all its cards?", { modal: true }, "Remove");
    if (confirmed !== "Remove") {
      return;
    }
    await this.mutateAndPost((board) => {
      const index = board.columns.findIndex((candidate) => candidate.id === columnId);
      if (index < 0) {
        throw new Error("Column not found.");
      }
      board.columns.splice(index, 1);
    });
  }

  private async addCard(columnId: string, text?: string): Promise<void> {
    if (!this.currentBoardUri) {
      return;
    }
    const resolved = await this.resolveCardText(text);
    if (resolved === undefined) {
      return;
    }
    await this.mutateAndPost((board) => {
      const column = board.columns.find((candidate) => candidate.id === columnId);
      if (!column) {
        throw new Error("Column not found.");
      }
      column.cards.unshift({ id: this.store.createId("card"), text: resolved });
    });
  }

  private async updateCard(columnId: string, cardId: string, text?: string, currentText?: string): Promise<void> {
    if (!this.currentBoardUri) {
      return;
    }
    const resolved = await this.resolveCardText(text, currentText ?? "");
    if (resolved === undefined) {
      return;
    }
    await this.mutateAndPost((board) => {
      const column = board.columns.find((candidate) => candidate.id === columnId);
      const card = column?.cards.find((candidate) => candidate.id === cardId);
      if (!card) {
        throw new Error("Card not found.");
      }
      card.text = resolved;
    });
  }

  private async removeCard(columnId: string, cardId: string): Promise<void> {
    if (!this.currentBoardUri) {
      return;
    }
    const confirmed = await vscode.window.showWarningMessage("Remove this card?", { modal: true }, "Remove");
    if (confirmed !== "Remove") {
      return;
    }
    await this.mutateAndPost((board) => {
      const column = board.columns.find((candidate) => candidate.id === columnId);
      if (!column) {
        throw new Error("Column not found.");
      }
      const index = column.cards.findIndex((candidate) => candidate.id === cardId);
      if (index < 0) {
        throw new Error("Card not found.");
      }
      column.cards.splice(index, 1);
    });
  }

  private async moveCard(cardId: string, fromColumnId: string, toColumnId: string, targetIndex: number): Promise<void> {
    if (!this.currentBoardUri) {
      return;
    }
    await this.mutateAndPost((board) => {
      const from = board.columns.find((candidate) => candidate.id === fromColumnId);
      const to = board.columns.find((candidate) => candidate.id === toColumnId);
      if (!from || !to) {
        throw new Error("Column not found.");
      }
      const sourceIndex = from.cards.findIndex((candidate) => candidate.id === cardId);
      if (sourceIndex < 0) {
        throw new Error("Card not found.");
      }
      const [card] = from.cards.splice(sourceIndex, 1);
      const boundedTarget = Math.max(0, Math.min(targetIndex, to.cards.length));
      to.cards.splice(boundedTarget, 0, card);
    });
  }

  private async startAgent(cardId: string): Promise<void> {
    const card = this.findCard(cardId);
    if (!card) {
      return;
    }
    await this.api.sessions.start({
      prompt: `Work on this ticket from my Argus board:\n\n${card.text}`,
      link: { plugin: "kanban", id: card.id },
      viewColumn: vscode.window.tabGroups.activeTabGroup.viewColumn
    });
  }

  private async mutateAndPost(mutator: (board: BoardData) => BoardData | void): Promise<void> {
    if (!this.currentBoardUri) {
      return;
    }
    try {
      this.lastBoard = await this.store.mutate(this.currentBoardUri, mutator);
      this.postState();
      this.chipsHandle?.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update Work board.";
      void vscode.window.showErrorMessage(`Argus: ${message}`);
    }
  }

  private findCard(cardId: string): Card | undefined {
    return this.lastBoard?.columns.flatMap((column) => column.cards).find((candidate) => candidate.id === cardId);
  }

  private async resolveColumnName(initial?: string, seed = ""): Promise<string | undefined> {
    if (initial && initial.trim().length > 0) {
      return initial.trim();
    }
    const entered = await vscode.window.showInputBox({
      title: "Column Name",
      prompt: "Enter a column name",
      value: seed || "New Column",
      ignoreFocusOut: true,
      validateInput: (candidate) => (candidate.trim().length > 0 ? undefined : "Column name is required")
    });
    return entered === undefined ? undefined : entered.trim();
  }

  private async resolveCardText(initial?: string, seed = ""): Promise<string | undefined> {
    if (initial && initial.trim().length > 0) {
      return initial.trim();
    }
    const entered = await vscode.window.showInputBox({
      title: "Card Text",
      prompt: "Enter card text",
      value: seed || "New Task",
      ignoreFocusOut: true,
      validateInput: (candidate) => (candidate.trim().length > 0 ? undefined : "Card text is required")
    });
    return entered === undefined ? undefined : entered.trim();
  }

  // ── Posting to the webview ───────────────────────────────────────────────

  private post(message: unknown): void {
    this.handle?.post(message);
  }

  private postState(): void {
    if (!this.currentBoardUri || !this.lastBoard) {
      return;
    }
    this.post({
      type: "state",
      boardPath: this.currentBoardUri.fsPath,
      board: this.lastBoard,
      prByCardId: this.prByCardId,
      lastSyncError: this.lastSyncError,
      prSyncedAt: this.prSyncedAt,
      syncing: this.syncing
    });
    this.postSessions();
  }

  private postSessions(): void {
    this.post({ type: "sessions", cards: this.api.sessions.getCards() });
  }

  // ── Session chips / archive cleanup ──────────────────────────────────────

  private chipsFor(card: SessionCard) {
    const linkedId = card.record.links?.kanban;
    if (!linkedId || !this.lastBoard) {
      return undefined;
    }
    const boardCard = this.lastBoard.columns.flatMap((column) => column.cards).find((candidate) => candidate.id === linkedId);
    if (!boardCard) {
      return undefined;
    }
    return [
      {
        text: `🎫 ${firstLine(boardCard.text, 40)}`,
        tooltip: boardCard.text,
        command: { command: "argus.kanban.open" }
      }
    ];
  }

  private async cleanupFor(card: SessionCard): Promise<CleanupItem[]> {
    const uri = this.store.resolveBoardUri();
    if (!uri || !(await this.store.boardExists(uri))) {
      return [];
    }

    let board: BoardData;
    try {
      board = await this.store.readBoard(uri);
    } catch {
      return [];
    }

    const linkedId = card.record.links?.kanban;
    const sessionPrUrls = new Set(card.record.prs ?? []);
    const items: CleanupItem[] = [];

    for (const column of board.columns) {
      for (const boardCard of column.cards) {
        const isLinked = linkedId !== undefined && boardCard.id === linkedId;
        const sharesPr = !isLinked && this.api.prs.parse(boardCard.text).some((url) => sessionPrUrls.has(url));
        if (!isLinked && !sharesPr) {
          continue;
        }
        items.push({
          label: `Remove work card: ${firstLine(boardCard.text, 80)}`,
          run: async () => {
            const currentUri = this.store.resolveBoardUri();
            if (!currentUri) {
              return;
            }
            try {
              this.lastBoard = await this.store.mutate(currentUri, (b) => {
                for (const col of b.columns) {
                  col.cards = col.cards.filter((c) => c.id !== boardCard.id);
                }
              });
              this.postState();
              this.chipsHandle?.refresh();
            } catch {
              // The board may have already been cleaned up or removed; nothing more to do.
            }
          }
        });
      }
    }

    return items;
  }
}
