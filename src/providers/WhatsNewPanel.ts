import * as fs from "fs";
import * as vscode from "vscode";
import { inlineMarkdown, parseChangelog, Release, ReleaseItem, versionToAnnounce } from "../services/releaseNotes";
import { escapeHtml, getNonce, MARK_SVG } from "./ControlCenter";
import { WELCOME_SHOWN_KEY } from "./WelcomePanel";

const SEEN_KEY = "argus.whatsNew.version";
const DOCS = "https://import-star.github.io/argus/";
const CHANGELOG = "https://github.com/Import-Star/argus/blob/main/CHANGELOG.md";
const EARLIER = 2;

// Release notes from the bundled CHANGELOG.md. Opens once after Argus updates, then from "Argus: What's New".
export class WhatsNewPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;

  public constructor(private readonly context: vscode.ExtensionContext) {}

  // Call before the welcome page's first-run check: its flag tells an update from a first install.
  public showOnUpdate(): void {
    const version = this.context.extension.packageJSON.version as string;
    const announce = versionToAnnounce(version, this.context.globalState.get<string>(SEEN_KEY), Boolean(this.context.globalState.get(WELCOME_SHOWN_KEY)));
    void this.context.globalState.update(SEEN_KEY, version);
    if (announce && vscode.workspace.getConfiguration("argus.whatsNew").get<boolean>("showOnUpdate", true) && this.releases().some((release) => release.version === announce)) {
      this.show();
    }
  }

  public show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }
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
    const releases = this.releases();
    const index = Math.max(0, releases.findIndex((release) => release.version === version));
    const current = releases[index];
    const items = (list: ReleaseItem[]) => `<ul>${list.map((item) => `<li>${inlineMarkdown(item.text)}</li>`).join("")}</ul>`;
    const picture = (item: ReleaseItem) => {
      if (!item.image) {
        return "";
      }
      const file = vscode.Uri.joinPath(this.context.extensionUri, item.image.path);
      // Snapshots are saved at 2x; show them at their CSS size. A PNG's width is bytes 16-19.
      const width = fs.readFileSync(file.fsPath).readUInt32BE(16) / 2;
      return `<img src="${webview.asWebviewUri(file)}" width="${width}" alt="${escapeHtml(item.image.alt)}" />`;
    };

    const highlights = current?.highlights.length
      ? `<section class="whatsnew-highlights">${current.highlights.map((item) => `<div class="welcome-step${item.image ? " has-image" : ""}"><div>${inlineMarkdown(item.text)}</div>${picture(item)}</div>`).join("")}</section>`
      : "";
    const changes = current?.changes.length ? `<section class="welcome-step"><h2>${current.highlights.length ? "Other changes" : "Changes"}</h2>${items(current.changes)}</section>` : "";
    const earlier = releases
      .slice(index + 1, index + 1 + EARLIER)
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
      <h1>What's new in <span class="mono">${escapeHtml(current?.version ?? version)}</span></h1>
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
