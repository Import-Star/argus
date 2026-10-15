import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { DiffResult, fileLines, loadDiff, Scope } from "./git";
import { loadPrDiff, prFileLines } from "./pr";
import { Draft, formatReview, ReviewComment } from "./review";

type Inbound =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "setScope"; scope: Scope }
  | { type: "setBase"; base: string }
  | { type: "setPr"; pr: string }
  | { type: "saveDraft"; comments: ReviewComment[]; note: string }
  | { type: "openFile"; path: string; line?: number }
  | { type: "fileLines"; path: string }
  | { type: "send" };

export class DiffPanel {
  private static readonly panels = new Map<string, DiffPanel>();

  private scope: Scope = "all";
  private baseOverride = "";
  // A PR number or URL; set means the panel shows that PR instead of the worktree.
  private pr = "";
  private last?: DiffResult;

  public static show(context: vscode.ExtensionContext, folder: string, sessionId?: string, pr?: string): void {
    const existing = DiffPanel.panels.get(folder);
    if (existing) {
      existing.sessionId = sessionId ?? existing.sessionId;
      existing.pr = pr ?? "";
      existing.panel.reveal();
      void existing.refresh();
      return;
    }
    const panel = new DiffPanel(context, folder, sessionId);
    panel.pr = pr ?? "";
    DiffPanel.panels.set(folder, panel);
  }

  public static disposeAll(): void {
    for (const panel of [...DiffPanel.panels.values()]) {
      panel.panel.dispose();
    }
  }

  private readonly panel: vscode.WebviewPanel;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly folder: string,
    private sessionId: string | undefined
  ) {
    const media = vscode.Uri.joinPath(context.extensionUri, "media", "diff-review");
    this.panel = vscode.window.createWebviewPanel("argusDiffReview", `Diff: ${path.basename(folder)}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [media]
    });
    this.panel.webview.html = this.html(media);
    this.panel.webview.onDidReceiveMessage((message: Inbound) => void this.onMessage(message));
    this.panel.onDidChangeViewState(() => this.panel.visible && void this.refresh());
    this.panel.onDidDispose(() => DiffPanel.panels.delete(folder));
  }

  private get draftKey(): string {
    return this.pr ? `draft:pr:${this.pr}` : `draft:${this.folder}`;
  }

  private get draft(): Draft {
    return this.context.globalState.get<Draft>(this.draftKey) ?? { comments: [], note: "" };
  }

  private async onMessage(message: Inbound): Promise<void> {
    switch (message.type) {
      case "ready":
      case "refresh":
        await this.refresh();
        break;
      case "setScope":
        this.scope = message.scope;
        await this.refresh();
        break;
      case "setBase":
        this.baseOverride = message.base.trim();
        await this.refresh();
        break;
      case "setPr":
        this.pr = message.pr.trim();
        await this.refresh();
        break;
      case "saveDraft":
        await this.context.globalState.update(this.draftKey, { comments: message.comments, note: message.note });
        break;
      case "openFile": {
        const line = Math.max((message.line ?? 1) - 1, 0);
        await vscode.window.showTextDocument(vscode.Uri.file(path.join(this.folder, message.path)), {
          viewColumn: vscode.ViewColumn.Beside,
          selection: new vscode.Range(line, 0, line, 0)
        });
        break;
      }
      case "fileLines": {
        const pr = this.last?.pr;
        const lines = await (pr ? prFileLines(this.folder, pr.repo, pr.headSha, message.path) : fileLines(this.folder, this.scope, message.path)).catch(
          () => []
        );
        void this.panel.webview.postMessage({ type: "fileLines", path: message.path, lines });
        break;
      }
      case "send":
        await this.send();
        break;
    }
  }

  private async refresh(): Promise<void> {
    const config = vscode.workspace.getConfiguration("argus.diffReview");
    const baseRef = this.baseOverride || config.get<string>("baseRef", "");
    const contextLines = config.get<number>("contextLines", 3);
    try {
      this.last = this.pr ? await loadPrDiff(this.folder, this.pr) : await loadDiff(this.folder, this.scope, baseRef, contextLines);
      // Normalise "123" and the URL to one draft key.
      this.pr = this.last.pr?.url ?? "";
      void this.panel.webview.postMessage({ type: "state", result: this.last, draft: this.draft, canSend: Boolean(this.sessionId) });
    } catch (error) {
      void this.panel.webview.postMessage({
        type: "error",
        folder: this.pr || this.folder,
        pr: Boolean(this.pr),
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async send(): Promise<void> {
    const draft = this.draft;
    if (!this.last || (draft.comments.length === 0 && !draft.note.trim())) {
      return;
    }
    await vscode.env.clipboard.writeText(formatReview(this.last, draft));
    await this.context.globalState.update(this.draftKey, undefined);
    void this.panel.webview.postMessage({ type: "sent" });
    if (this.sessionId) {
      await vscode.commands.executeCommand("argus.sessions.open", { record: { sessionId: this.sessionId } });
    }
    void vscode.window.showInformationMessage(
      `Argus: review copied (${draft.comments.length} comment${draft.comments.length === 1 ? "" : "s"}). Paste it into the Claude session.`
    );
  }

  private html(media: vscode.Uri): string {
    const webview = this.panel.webview;
    const nonce = crypto.randomBytes(16).toString("base64");
    const script = webview.asWebviewUri(vscode.Uri.joinPath(media, "diff.js"));
    const highlighter = webview.asWebviewUri(vscode.Uri.joinPath(media, "vendor", "highlight.min.js"));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(media, "diff.css"));
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
</head>
<body>
<div id="app"><div class="empty">Loading diff…</div></div>
<script nonce="${nonce}" src="${highlighter}"></script>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}
