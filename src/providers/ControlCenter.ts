import * as path from "path";
import * as vscode from "vscode";
import { ArgusTab, TabHandle } from "../types";

const ACTIVE_TAB_KEY = "argus.controlCenter.activeTab";

// media/logo-mono.svg inlined (an <img> can't take currentColor), so the header mark picks up the coral accent.
const MARK_SVG =
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">` +
  `<defs><path id="argus-mark-eye" d="M-2.3 0C-1.3-1.7 1.3-1.7 2.3 0C1.3 1.7-1.3 1.7-2.3 0Z"/></defs>` +
  `<g transform="translate(12 12)">` +
  [0, 45, 90, 135, 180, 225, 270, 315]
    .map((angle) => `<use href="#argus-mark-eye" transform="rotate(${angle}) translate(0 -10)"/>`)
    .join("") +
  `</g>` +
  `<path d="M5.2 12C7.2 8.6 16.8 8.6 18.8 12C16.8 15.4 7.2 15.4 5.2 12Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>` +
  `<circle cx="12" cy="12" r="2.3"/>` +
  `</svg>`;

interface RegisteredTab {
  tab: ArgusTab;
  badge?: number;
  lastVisible: boolean;
}

// Hosts the Control Center webview panel: one tab host script (media/host.js) that mounts a Sessions tab
// (registered by core through the same registerTab API a plugin uses) plus every tab a plugin registers.
export class ControlCenter implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private readonly tabs = new Map<string, RegisteredTab>();
  private activeTabId: string | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.activeTabId = context.globalState.get<string>(ACTIVE_TAB_KEY);
  }

  public registerTab(tab: ArgusTab): TabHandle {
    if (this.tabs.has(tab.id)) {
      throw new Error(`Argus: a tab with id "${tab.id}" is already registered.`);
    }
    this.tabs.set(tab.id, { tab, lastVisible: false });
    this.reloadIfOpen();

    const isVisible = () => Boolean(this.panel?.visible) && this.activeTabId === tab.id;

    const handle: TabHandle = {
      post: (message: unknown) => {
        if (!this.panel) {
          return;
        }
        void this.panel.webview.postMessage({ type: "tab", tab: tab.id, message });
      },
      setBadge: (count: number | undefined) => {
        const entry = this.tabs.get(tab.id);
        if (entry) {
          entry.badge = count;
        }
        if (this.panel) {
          void this.panel.webview.postMessage({ type: "badge", tab: tab.id, count: count ?? 0 });
        }
      },
      get visible() {
        return isVisible();
      },
      dispose: () => {
        this.tabs.delete(tab.id);
        if (this.activeTabId === tab.id) {
          this.activeTabId = undefined;
        }
        this.reloadIfOpen();
      }
    };
    return handle;
  }

  public async openControlCenter(tabId?: string): Promise<void> {
    const target = tabId && this.tabs.has(tabId) ? tabId : this.activeTabId && this.tabs.has(this.activeTabId) ? this.activeTabId : this.defaultTabId();
    this.setActiveTab(target);

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One, true);
      void this.panel.webview.postMessage({ type: "activate", tab: target });
      this.notifyVisibility();
      return;
    }

    this.attachPanel(
      vscode.window.createWebviewPanel(
        "argusControlCenter",
        "Control Center",
        { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
        { retainContextWhenHidden: true, ...this.webviewOptions() }
      )
    );
  }

  public registerSerializer(): vscode.Disposable {
    return vscode.window.registerWebviewPanelSerializer("argusControlCenter", {
      deserializeWebviewPanel: async (panel) => {
        panel.webview.options = this.webviewOptions();
        this.attachPanel(panel);
      }
    });
  }

  private attachPanel(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.panel.onDidChangeViewState(() => this.notifyVisibility());
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.notifyVisibility();
    });
    this.panel.webview.onDidReceiveMessage((message: unknown) => this.handleMessage(message));

    this.disposables.push(this.panel);
    this.notifyVisibility();
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.panel = undefined;
  }

  private defaultTabId(): string | undefined {
    const ordered = [...this.tabs.values()].sort((a, b) => (a.tab.order ?? 100) - (b.tab.order ?? 100));
    return ordered[0]?.tab.id;
  }

  private setActiveTab(tabId: string | undefined): void {
    this.activeTabId = tabId;
    void this.context.globalState.update(ACTIVE_TAB_KEY, tabId);
  }

  private reloadIfOpen(): void {
    if (!this.panel) {
      return;
    }
    if (this.activeTabId && !this.tabs.has(this.activeTabId)) {
      this.activeTabId = this.defaultTabId();
    }
    this.panel.webview.options = this.webviewOptions();
    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.notifyVisibility();
  }

  private webviewOptions(): vscode.WebviewOptions {
    const roots = new Set<string>([vscode.Uri.joinPath(this.context.extensionUri, "media").fsPath]);
    for (const { tab } of this.tabs.values()) {
      roots.add(path.dirname(tab.script.fsPath));
      if (tab.style) {
        roots.add(path.dirname(tab.style.fsPath));
      }
    }
    return {
      enableScripts: true,
      localResourceRoots: [...roots].map((fsPath) => vscode.Uri.file(fsPath))
    };
  }

  private async handleMessage(message: unknown): Promise<void> {
    const msg = message as { type?: string; tab?: string; message?: unknown; sessionId?: string; url?: string } | undefined;
    if (!msg || typeof msg.type !== "string") {
      return;
    }
    switch (msg.type) {
      case "activate":
        if (typeof msg.tab === "string" && this.tabs.has(msg.tab)) {
          this.setActiveTab(msg.tab);
          this.notifyVisibility();
        }
        return;
      case "openExternal":
        if (typeof msg.url === "string" && msg.url.startsWith("https:")) {
          await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        }
        return;
      case "openSession":
        if (typeof msg.sessionId === "string") {
          await vscode.commands.executeCommand("argus.sessions.open", { record: { sessionId: msg.sessionId } });
        }
        return;
      case "tab": {
        const entry = typeof msg.tab === "string" ? this.tabs.get(msg.tab) : undefined;
        await entry?.tab.onMessage?.(msg.message);
        return;
      }
      default:
        return;
    }
  }

  private notifyVisibility(): void {
    for (const entry of this.tabs.values()) {
      const visible = Boolean(this.panel?.visible) && this.activeTabId === entry.tab.id;
      if (visible !== entry.lastVisible) {
        entry.lastVisible = visible;
        try {
          entry.tab.onDidChangeVisibility?.(visible);
        } catch (error) {
          console.warn(`Argus: tab "${entry.tab.id}" onDidChangeVisibility threw: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const hostUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "host.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "styles.css"));

    const ordered = [...this.tabs.values()].sort((a, b) => (a.tab.order ?? 100) - (b.tab.order ?? 100));
    const active = this.activeTabId && this.tabs.has(this.activeTabId) ? this.activeTabId : ordered[0]?.tab.id;

    const tabsMeta = ordered.map((entry) => ({ id: entry.tab.id, title: entry.tab.title, badge: entry.badge }));
    // Escape "<" as the JSON escape u003c (backslash built with fromCharCode) so a tab title can never close the script element.
    const json = (value: unknown) => JSON.stringify(value).replace(/</g, String.fromCharCode(92) + "u003c");
    const initScript = `window.__argusTabs = ${json(tabsMeta)}; window.__argusActive = ${json(active ?? "")};`;

    const styleLinks = [`<link rel="stylesheet" href="${styleUri}" />`];
    const extraStyles = ordered
      .filter((entry) => entry.tab.style)
      .map((entry) => `<link rel="stylesheet" href="${webview.asWebviewUri(entry.tab.style as vscode.Uri)}" />`);

    const scriptTags = [
      `<script nonce="${nonce}">${initScript}</script>`,
      `<script nonce="${nonce}" src="${hostUri}"></script>`,
      ...ordered.map((entry) => `<script nonce="${nonce}" src="${webview.asWebviewUri(entry.tab.script)}"></script>`)
    ];

    const sections = ordered.map((entry) => `<section data-tab-root="${escapeHtml(entry.tab.id)}" hidden></section>`).join("");

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"
    />
    ${[...styleLinks, ...extraStyles].join("\n    ")}
    <title>Control Center</title>
  </head>
  <body>
    <header class="top-bar" id="argus-top-bar">
      <div class="mark"><span>${MARK_SVG}</span>Argus</div>
      <div class="tabs" id="argus-tabs"></div>
    </header>
    <main id="argus-tab-content">${sections}</main>
    ${scriptTags.join("\n    ")}
  </body>
</html>`;
  }
}

function escapeHtml(value: string): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getNonce(): string {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i += 1) {
    value += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return value;
}
