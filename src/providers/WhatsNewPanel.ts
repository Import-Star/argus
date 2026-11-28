import * as fs from "fs";
import * as vscode from "vscode";
import { inlineMarkdown, notesFor, parseChangelog, Release, ReleaseItem, versionToAnnounce } from "../services/releaseNotes";
import { escapeHtml, getNonce, MARK_SVG } from "./ControlCenter";
import { WELCOME_SHOWN_KEY } from "./WelcomePanel";

const SEEN_KEY = "argus.whatsNew.version";
const DOCS = "https://import-star.github.io/argus/";
const CHANGELOG = "https://github.com/Import-Star/argus/blob/main/CHANGELOG.md";
const EARLIER = 2;

// Release notes from the bundled CHANGELOG.md. Opens once after Argus updates, then from "Argus: What's New".
export class WhatsNewPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private since?: string;

  public constructor(private readonly context: vscode.ExtensionContext) {}

  // Call before the welcome page's first-run check: its flag tells an update from a first install.
  public showOnUpdate(): void {
    const version = this.context.extension.packageJSON.version as string;
    const lastSeen = this.context.globalState.get<string>(SEEN_KEY);
    const announce = versionToAnnounce(version, lastSeen, Boolean(this.context.globalState.get(WELCOME_SHOWN_KEY)));
    void this.context.globalState.update(SEEN_KEY, version);
    if (announce && vscode.workspace.getConfiguration("argus.whatsNew").get<boolean>("showOnUpdate", true) && this.releases().some((release) => release.version === announce)) {
      this.show(lastSeen);
    }
  }

  // `since`: the version Argus was updated from, whose later releases all show in full.
  public show(since?: string): void {
    if (this.panel) {
      this.since = since ?? this.since;
      this.panel.webview.html = this.getHtml(this.panel.webview);
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    this.since = since;
    this.panel = vscode.window.createWebviewPanel("argusWhatsNew", "What's New in Argus", vscode.ViewColumn.One, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")]
    });
    this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "media", "icon.png");
    this.panel.onDidDispose(() => (this.panel = undefined));
    this.panel.webview.onDidReceiveMessage((message: { type?: string; url?: string; command?: string }) => {
      if (message?.type === "openExternal" && message.url?.startsWith("https://")) {
        void vscode.env.openExternal(vscode.Uri.parse(message.url));
      } else if (message?.type === "command" && message.command === "argus.whatsNew.settings") {
        void vscode.commands.executeCommand("workbench.action.openSettings", "argus.whatsNew.showOnUpdate");
        // welcome.js disables a command button while it runs; redraw to turn it back on.
        this.panel!.webview.html = this.getHtml(this.panel!.webview);
      }
    });
    this.panel.webview.html = this.getHtml(this.panel.webview);
  }

  public dispose(): void {
    this.panel?.dispose();
  }

  private releases(): Release[] {
    try {
      return parseChangelog(fs.readFileSync(vscode.Uri.joinPath(this.context.extensionUri, "CHANGELOG.md").fsPath, "utf8"));
    } catch {
      return [];
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "styles.css"));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "welcome.js"));
    const version = this.context.extension.packageJSON.version as string;
    const { current, missed, earlier: before } = notesFor(this.releases(), version, this.since);
    const items = (list: ReleaseItem[]) => `<ul>${list.map((item) => `<li>${inlineMarkdown(item.text)}</li>`).join("")}</ul>`;
    const picture = (item: ReleaseItem) => {
      if (!item.image) {
        return "";
      }
      const file = vscode.Uri.joinPath(this.context.extensionUri, item.image.path);
      // Snapshots are saved at 2x; show them at their CSS size. A PNG's width is bytes 16-19.
      const width = fs.readFileSync(file.fsPath).readUInt32BE(16) / 2;
      return `<img src="${webview.asWebviewUri(file)}" width="${width}" alt="${escapeHtml(item.image.alt)}" title="Click to see it full size" />`;
    };

    // Every release since the update's starting version, newest first: their highlights as cards, then each one's
    // changes under its version.
    const shown = missed.length ? missed : current ? [current] : [];
    const allHighlights = shown.flatMap((release) => release.highlights);
    const highlights = allHighlights.length
      ? `<section class="whatsnew-highlights">${allHighlights.map((item) => `<div class="welcome-step${item.image ? " has-image" : ""}"><div>${inlineMarkdown(item.text)}</div>${picture(item)}</div>`).join("")}</section>`
      : "";
    const changeTitle = (release: Release) => (missed.length ? `Changes in <span class="mono">${escapeHtml(release.version)}</span>` : release.highlights.length ? "Other changes" : "Changes");
    const changes = shown
      .filter((release) => release.changes.length)
      .map((release) => `<section class="welcome-step"><h2>${changeTitle(release)}</h2>${items(release.changes)}</section>`)
      .join("");
    const title = missed.length && this.since ? `What's new since <span class="mono">${escapeHtml(this.since)}</span>` : `What's new in <span class="mono">${escapeHtml(current?.version ?? version)}</span>`;
    const earlier = before
      .slice(0, EARLIER)
      .map((release) => `<h3>${escapeHtml(release.version)}</h3>${items([...release.highlights, ...release.changes])}`)
      .join("");

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>What's New in Argus</title>
  </head>
  <body class="welcome whatsnew">
    <header class="welcome-head">
      <div class="mark"><span>${MARK_SVG}</span>Argus</div>
      <h1>${title}</h1>
    </header>
    ${highlights || changes ? `${highlights}${changes}` : `<p class="welcome-meta">No release notes for this version.</p>`}
    ${earlier ? `<details class="whatsnew-earlier"><summary>Earlier releases</summary>${earlier}</details>` : ""}
    <div class="welcome-actions">
      <button data-url="${DOCS}">Docs</button>
      <button data-url="${CHANGELOG}">Full Changelog</button>
      <button data-command="argus.whatsNew.settings">Don't Show After Updates…</button>
    </div>
    <p class="welcome-meta welcome-foot">Open this page again any time with <b>Argus: What's New</b>.</p>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}
