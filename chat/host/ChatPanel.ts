import { randomBytes } from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { multiAgentEnabled } from "../../src/chat/multiAgent";
import type { HostMessage, WebviewMessage } from "../../src/chat/protocol";
import type { ChatManager } from "./ChatManager";
import type { ChatSession } from "./ChatSession";
import { rewind } from "./history";
import { commentsPrompt, fileDiff, listChanges } from "./review";
import { SideQuestion } from "./sideQuestion";
import { taskOutput } from "./tasks";
import { planUsage, shellTaskOutput } from "./usage";

export class ChatPanel implements vscode.Disposable {
  private readonly panel: vscode.WebviewPanel;
  private readonly subscriptions: vscode.Disposable[] = [];
  private sessionDisposables = new Map<string, vscode.Disposable>();
  private readonly asides = new Map<string, SideQuestion>();
  private ready = false;
  private markReady!: () => void;
  public readonly whenReady = new Promise<void>((resolve) => (this.markReady = resolve));
  private readonly onDisposeEmitter = new vscode.EventEmitter<void>();
  public readonly onDidDispose = this.onDisposeEmitter.event;
  private readonly focusEmitter = new vscode.EventEmitter<void>();
  public readonly onDidFocus = this.focusEmitter.event;

  constructor(
    private readonly manager: ChatManager,
    extensionUri: vscode.Uri,
    public view: "single" | "grid",
    private ids: string[],
    column?: vscode.ViewColumn,
    private group?: string,
    existing?: vscode.WebviewPanel
  ) {
    const root = vscode.Uri.joinPath(extensionUri, "out", "chat");
    const options = { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [root] };
    if (existing) {
      this.panel = existing;
      this.panel.webview.options = options;
      this.panel.title = this.title();
    } else {
      this.panel = vscode.window.createWebviewPanel(view === "grid" ? "argusChatGrid" : "argusChat", this.title(), column ?? vscode.ViewColumn.Active, options);
    }
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, "media", "icon.png");
    this.panel.webview.html = this.html(root);
    this.subscriptions.push(
      this.panel.webview.onDidReceiveMessage((message: WebviewMessage) => void this.handle(message)),
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.onDidChangeViewState((event) => event.webviewPanel.active && this.focusEmitter.fire())
    );
    this.watchSessions();
  }

  public get sessionIds(): readonly string[] {
    return this.ids;
  }

  public reveal(): void {
    this.panel.reveal();
  }

  public get groupId(): string | undefined {
    return this.group;
  }

  // A single chat tab becomes the grid in place when an agent joins, and back again when one chat is left.
  public setView(view: "single" | "grid", ids: string[], groupId?: string): Promise<void> {
    this.view = view;
    return this.setSessions(ids, groupId);
  }

  // Only newly shown chats get their history; resending the rest re-renders every tile.
  public setSessions(ids: string[], groupId?: string): Promise<void> {
    const added = ids.filter((id) => !this.ids.includes(id));
    this.ids = ids;
    this.group = groupId;
    this.panel.title = this.title();
    this.watchSessions();
    return this.ready ? this.sendAll(added) : this.whenReady;
  }

  public post(message: HostMessage): void {
    if (this.ready) {
      void this.panel.webview.postMessage(message);
    }
  }

  public refreshTitle(): void {
    this.panel.title = this.title();
  }

  public dispose(): void {
    this.subscriptions.forEach((item) => item.dispose());
    this.sessionDisposables.forEach((item) => item.dispose());
    this.sessionDisposables.clear();
    this.asides.forEach((item) => item.dispose());
    this.panel.dispose();
    this.onDisposeEmitter.fire();
    this.onDisposeEmitter.dispose();
    this.focusEmitter.dispose();
  }

  private title(): string {
    const full = this.fullTitle();
    return full.length > 40 ? `${full.slice(0, 39).trimEnd()}…` : full;
  }

  private fullTitle(): string {
    if (this.view === "grid") {
      const group = this.manager.groups().find((entry) => entry.id === this.group);
      return group?.title || `Chats (${this.ids.length})`;
    }
    const meta = this.manager.session(this.ids[0])?.meta;
    return meta?.title || "New chat";
  }

  private watchSessions(): void {
    for (const [id, disposable] of this.sessionDisposables) {
      if (!this.ids.includes(id)) {
        disposable.dispose();
        this.sessionDisposables.delete(id);
      }
    }
    for (const [id, aside] of this.asides) {
      if (!this.ids.includes(id)) {
        aside.dispose();
        this.asides.delete(id);
      }
    }
    for (const id of this.ids) {
      const session = this.manager.session(id);
      if (session && !this.sessionDisposables.has(id)) {
        this.sessionDisposables.set(
          id,
          session.onMessage((message) => {
            this.post(message);
            if (message.type === "meta") {
              this.refreshTitle();
            }
          })
        );
      }
    }
  }

  public sendLayout(): void {
    this.post({ type: "layout", view: this.view, sessionIds: this.ids, groupId: this.group, multiAgent: multiAgentEnabled() });
  }

  private async sendAll(ids: readonly string[] = this.ids): Promise<void> {
    this.sendLayout();
    this.post({ type: "groups", groups: this.manager.groups() });
    this.post({ type: "rail", sessions: this.manager.rail() });
    for (const id of ids) {
      const session = this.manager.session(id);
      if (!session) {
        continue;
      }
      this.post({ type: "meta", meta: session.meta });
      const card = this.manager.card(id);
      if (card) {
        this.post({ type: "card", card });
      }
      this.post({ type: "history", sessionId: id, messages: await session.history() });
      for (const request of session.pendingRequests()) {
        this.post({ type: "permission", sessionId: id, request });
      }
      this.post({ type: "queue", sessionId: id, items: session.queued() });
    }
  }

  private async handle(message: WebviewMessage): Promise<void> {
    if (message.type === "ready") {
      this.ready = true;
      await this.sendAll();
      this.markReady();
      return;
    }
    if (message.type === "openUrl") {
      await vscode.env.openExternal(vscode.Uri.parse(message.url));
      return;
    }
    if (message.type === "newChat") {
      await this.manager.open();
      return;
    }
    if (message.type === "addAgent") {
      await this.manager.addAgent(message.sessionId);
      return;
    }
    if (message.type === "openGroup") {
      this.manager.openGroup(message.sessionId);
      return;
    }
    if (message.type === "openSession") {
      await this.manager.open(message.sessionId);
      return;
    }
    if (message.type === "grid") {
      this.manager.gridAction(message.action, message.sessionId, this);
      return;
    }
    if (message.type === "archive") {
      await this.manager.archive(message.sessionId);
      return;
    }
    const session = this.manager.session(message.sessionId);
    if (!session) {
      return;
    }
    const cwd = session.meta.cwd;
    try {
      switch (message.type) {
        case "send":
          session.send(message.text, message.images);
          return;
        case "interrupt":
          await session.interrupt();
          return;
        case "setModel":
          await session.setModel(message.model);
          this.manager.remember(session.sessionId, { model: message.model });
          return;
        case "setEffort":
          await session.setEffort(message.effort);
          this.manager.remember(session.sessionId, { effort: message.effort });
          return;
        case "setPermissionMode":
          await session.setPermissionMode(message.mode);
          this.manager.remember(session.sessionId, { permissionMode: message.mode });
          return;
        case "permission":
          session.respond(message.id, message.decision);
          return;
        case "fileSuggestions":
          this.post({ type: "fileSuggestions", sessionId: session.sessionId, query: message.query, files: await this.manager.findFiles(cwd, message.query) });
          return;
        case "openFile": {
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.resolve(this.manager.worktreePath(session.sessionId, message.worktree) ?? cwd, message.path)));
          const line = Math.max(0, (message.line ?? 1) - 1);
          await vscode.window.showTextDocument(document, { preview: true, selection: new vscode.Range(line, 0, line, 0) });
          return;
        }
        case "changes": {
          const worktree = this.manager.worktreePath(session.sessionId, message.worktree);
          this.post({ type: "changes", sessionId: session.sessionId, scope: message.scope, ...(await listChanges(session, message.scope, message.files, message.prUrl, worktree)), prUrl: message.prUrl, worktree });
          return;
        }
        case "fileDiff": {
          const worktree = this.manager.worktreePath(session.sessionId, message.worktree);
          this.post({ type: "fileDiff", sessionId: session.sessionId, scope: message.scope, prUrl: message.prUrl, worktree, diff: await fileDiff(session, message.scope, message.path, message.files, message.prUrl, worktree) });
          return;
        }
        case "sendComments":
          session.send(commentsPrompt(message.comments, session.meta.cwd));
          return;
        case "taskOutput":
          this.post({ type: "taskOutput", sessionId: session.sessionId, taskId: message.taskId, output: (await shellTaskOutput(session, message.taskId)) ?? (await taskOutput(session, message.taskId)) });
          return;
        case "usage": {
          const usage = await planUsage(session);
          if (usage !== undefined) {
            this.post({ type: "usage", sessionId: session.sessionId, usage });
          }
          return;
        }
        case "stopTask":
          await session.stopTask(message.taskId);
          return;
        case "queue":
          session.queueAction(message.id, message.action, message.text);
          return;
        case "rewind":
          await rewind(session, message);
          return;
        case "fork":
          await this.manager.forkAgent(session.sessionId, message.messageId, message.before === true, message.draft);
          return;
        case "aside":
          this.aside(session).ask(message.askId, message.text, session.meta.model);
          return;
        case "asideClose":
          this.asides.get(session.sessionId)?.dispose();
          this.asides.delete(session.sessionId);
          return;
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`Argus chat: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private aside(session: ChatSession): SideQuestion {
    let aside = this.asides.get(session.sessionId);
    if (!aside) {
      aside = new SideQuestion({ sessionId: session.sessionId, cwd: session.meta.cwd, ...this.manager.sideQuestionDefaults(session.meta.cwd), emit: (message) => this.post(message) });
      this.asides.set(session.sessionId, aside);
    }
    return aside;
  }

  private html(root: vscode.Uri): string {
    const webview = this.panel.webview;
    const nonce = randomBytes(16).toString("base64");
    const script = webview.asWebviewUri(vscode.Uri.joinPath(root, "webview.js"));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(root, "webview.css"));
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${style}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}
