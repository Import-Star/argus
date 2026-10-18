import * as vscode from "vscode";
import { trackingStatus, TrackingStatus } from "../services/HookInstaller";
import { PLUGINS_DIR } from "../services/PluginHost";
import { escapeHtml, getNonce, MARK_SVG } from "./ControlCenter";

const SHOWN_KEY = "argus.welcome.shown";
const PLUGIN_GUIDE = "https://github.com/Import-Star/argus/blob/main/DEVELOPING.md#writing-a-plugin";

// Commands the page may run. Anything else posted from the webview is ignored.
const ALLOWED = new Set([
  "argus.sessions.installHooks",
  "argus.sessions.removeHooks",
  "argus.openControlCenter",
  "argus.sessions.importChats",
  "argusSessions.focus",
  "argus.plugins.openFolder",
  "argus.plugins.reload"
]);

// The getting-started page: whether session tracking is set up (and a button to do it), and how plugins extend
// Argus. Opens once after the first install (unless tracking is already set up), then from "Argus: Welcome".
export class WelcomePanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly pluginNames: () => string[]
  ) {}

  public showOnFirstRun(): void {
    if (this.context.globalState.get<boolean>(SHOWN_KEY)) {
      return;
    }
    void this.context.globalState.update(SHOWN_KEY, true);
    // Someone upgrading from a build without this page already has tracking set up; don't greet them.
    if (trackingStatus(this.context.extensionPath).hooked === 0) {
      this.show();
    }
  }

  public show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      this.render();
      return;
    }
    this.panel = vscode.window.createWebviewPanel("argusWelcome", "Welcome to Argus", vscode.ViewColumn.One, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")]
    });
    this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "media", "icon.png");
    this.panel.onDidDispose(() => (this.panel = undefined));
    // Tracking can be set up from the command palette while the page is in the background.
    this.panel.onDidChangeViewState((event) => event.webviewPanel.visible && this.render());
    this.panel.webview.onDidReceiveMessage((message: unknown) => this.handleMessage(message));
    this.render();
  }

  public dispose(): void {
    this.panel?.dispose();
  }

  private async handleMessage(message: unknown): Promise<void> {
    const msg = message as { type?: string; command?: string; url?: string } | undefined;
    if (msg?.type === "command" && typeof msg.command === "string" && ALLOWED.has(msg.command)) {
      await vscode.commands.executeCommand(msg.command);
      this.render();
    } else if (msg?.type === "openExternal" && msg.url === PLUGIN_GUIDE) {
      await vscode.env.openExternal(vscode.Uri.parse(PLUGIN_GUIDE));
    }
  }

  private render(): void {
    if (this.panel) {
      this.panel.webview.html = this.getHtml(this.panel.webview, trackingStatus(this.context.extensionPath), this.pluginNames());
    }
  }

  private getHtml(webview: vscode.Webview, status: TrackingStatus, plugins: string[]): string {
    const nonce = getNonce();
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "styles.css"));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "welcome.js"));
    const button = (command: string, label: string, primary = false) =>
      `<button${primary ? ` class="primary"` : ""} data-command="${command}">${escapeHtml(label)}</button>`;

    const complete = status.hooked === status.events && status.scriptCurrent;
    let state: { tone: string; title: string; detail: string };
    if (status.hooked === 0) {
      state = { tone: "off", title: "Not set up", detail: "Claude Code sessions won't show on the board until session tracking is set up." };
    } else if (!complete) {
      state = {
        tone: "warn",
        title: "Needs an update",
        detail: `${status.hooked} of ${status.events} hooks are installed${status.scriptCurrent ? "" : " and the hook script is from another Argus version"}. Run setup again to bring them up to date.`
      };
    } else {
      state = { tone: "on", title: "Set up", detail: `All ${status.events} hooks are installed in ${status.settingsPath}.` };
    }
    const nodeLine = status.node
      ? `<p class="welcome-meta">Hooks run with Node at <span class="mono">${escapeHtml(status.node)}</span>.</p>`
      : `<p class="welcome-warn">Node 24 or newer wasn't found. The hooks need it to run: install Node 24+, then run setup again.</p>`;

    const pluginLine =
      plugins.length > 0
        ? `<p class="welcome-meta">Loaded: ${plugins.map((name) => `<span class="mono">${escapeHtml(name)}</span>`).join(", ")}.</p>`
        : `<p class="welcome-meta">No plugins loaded yet.</p>`;

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Welcome to Argus</title>
  </head>
  <body class="welcome">
    <header class="welcome-head">
      <div class="mark"><span>${MARK_SVG}</span>Argus</div>
      <h1>Watch every Claude Code session from one place</h1>
      <p>Argus shows your Claude Code sessions on a board: which need you, which are working, which have a PR open.
      It learns about them through Claude Code hooks.</p>
    </header>

    <section class="welcome-step">
      <h2><span class="step-no">1</span>Session tracking <span class="pill ${state.tone}">${state.title}</span></h2>
      <p>${escapeHtml(state.detail)}</p>
      ${nodeLine}
      <p>Setup adds hooks to <span class="mono">~/.claude/settings.json</span> (backed up to <span class="mono">settings.json.bak</span>)
      that run a small script on each Claude Code event and write the session's state to <span class="mono">~/.claude/argus/sessions</span>.
      Nothing leaves your machine. Sessions started after setup appear on the board.</p>
      <div class="welcome-actions">
        ${complete ? button("argus.sessions.installHooks", "Run Setup Again") : button("argus.sessions.installHooks", status.hooked === 0 ? "Set Up Session Tracking" : "Update Session Tracking", true)}
        ${status.hooked > 0 ? button("argus.sessions.removeHooks", "Remove Session Tracking") : ""}
      </div>
      <p class="welcome-meta">Also in the command palette: <b>Argus: Set Up Session Tracking</b> and <b>Argus: Remove Session Tracking</b>.</p>
    </section>

    <section class="welcome-step">
      <h2><span class="step-no">2</span>Open the board</h2>
      <p>The Sessions view in the activity bar lists sessions by column. The Control Center shows the full board, with search and diff review.</p>
      <div class="welcome-actions">
        ${button("argus.openControlCenter", "Open Control Center", complete)}
        ${button("argusSessions.focus", "Show Sessions View")}
      </div>
      <p>Chats from before Argus was installed aren't on the board until they next run. To add them now, import them
      from Claude Code's transcripts.</p>
      <div class="welcome-actions">${button("argus.sessions.importChats", "Import Existing Chats")}</div>
    </section>

    <section class="welcome-step">
      <h2><span class="step-no">3</span>Extend Argus with plugins</h2>
      <p>A plugin can add a tab to the Control Center, chips to session cards, extra steps when a session is archived,
      and its own commands. Plugins are folders in <span class="mono">${escapeHtml(PLUGINS_DIR)}</span>: put a plugin's folder there,
      build it, then run <b>Argus: Reload Plugins</b>. Argus asks once before loading each new plugin, because a plugin
      runs with the same access to your machine that Argus has.</p>
      ${pluginLine}
      <p>To write your own, start from the plugin guide. Argus writes <span class="mono">argus.d.ts</span> and
      <span class="mono">argus-webview.d.ts</span> into the plugins folder so a plugin type-checks against the Argus it runs on.</p>
      <div class="welcome-actions">
        ${button("argus.plugins.openFolder", "Open Plugins Folder")}
        ${button("argus.plugins.reload", "Reload Plugins")}
        <button data-url="${PLUGIN_GUIDE}">Read the Plugin Guide</button>
      </div>
    </section>

    <p class="welcome-meta welcome-foot">Open this page again any time with <b>Argus: Welcome</b>.</p>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}
