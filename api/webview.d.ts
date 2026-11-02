// Webview side of an Argus tab. The core loads its host script first, which defines `window.argus`; each tab
// script (ArgusTab.script) then calls argus.registerTab() with the same id it used in the extension.
//
//   argus.registerTab("kanban", {
//     mount(root, ctx) { this.root = root; this.ctx = ctx; ctx.post({ type: "ready" }); },
//     onMessage(message) { render(this.root, message); }
//   });
//
// Plain JS, no build step. The CSP allows no inline scripts or event handlers: bind listeners in code, and escape
// every interpolated value with ctx.esc(). The tab owns everything inside `root`, including its own toolbar and
// status line.
//
// Provided by the core for every tab:
// - CSS: the VS Code theme variables and these classes from the core stylesheet: .mono kbd button button.primary
//   button.icon button.link .statusline (.n .right) .row (.l1 .l2 .title .t .actions .activity) .glyph
//   (.spin .ok .bad .dot) .chips .chip (.pr-open .pr-merged .pr-closed) .empty-line .sync-error .muted .badge.
//   Anything else goes in the tab's own stylesheet, scoped under [data-tab-root="<id>"].
// - Live timers: any element with class "t" and data-since="<epoch ms>" is re-rendered every second as elapsed time
//   ("5m", "2h 3m"); add data-precise="true" for "4m 07s". data-until="<epoch ms>" counts down instead ("in 5m").
// - Spinner: elements with class "glyph spin" animate.

interface ArgusWebviewContext {
  post(message: unknown): void; // to ArgusTab.onMessage in the plugin extension
  esc(value: unknown): string; // HTML-escapes String(value); null and undefined become ""
  elapsed(sinceMs: number): string;
  elapsedPrecise(sinceMs: number): string;
  remaining(untilMs: number): string; // "in 5m"
  openExternal(url: string): void; // https URLs only
  openSession(sessionId: string): void;
  getState<T>(): T | undefined; // per-tab UI state that survives panel reloads
  setState<T>(state: T): void;
}

interface ArgusWebviewTab {
  mount(root: HTMLElement, ctx: ArgusWebviewContext): void;
  onMessage?(message: unknown): void;
  onShow?(): void;
  onHide?(): void;
}

interface Window {
  argus: {
    registerTab(id: string, tab: ArgusWebviewTab): void;
  };
}

// Webview side of a chat extension (ArgusApi.registerChatExtension). The chat's bundle defines window.argusChat
// before plugin scripts load; register with the same id the plugin used in the extension. Plain JS or a bundled
// script, under the same CSP rules as a tab. The chat sets the VS Code theme variables (--vscode-*): use those.
//
//   argusChat.registerExtension("read-aloud", {
//     mount(ctx) { ctx.addReplyAction({ id: "read", title: "Read aloud", icon: "M11 5L6 9H2v6h4l5 4z", onClick: speak }); },
//     onMessage(message) { ... }
//   });

interface ArgusChatContext {
  post(message: unknown): void; // to ArgusChatExtension.onMessage in the plugin extension
  // A button beside Copy under every finished reply from Claude.
  addReplyAction(action: ArgusReplyAction): { dispose(): void };
}

interface ArgusReplyAction {
  id: string; // unique within the extension, lowercase [a-z0-9-]
  title: string;
  icon: string; // SVG path data on a 24x24 grid, stroked in the current text colour
  activeIcon?: string; // shown instead while reply.setActive(true)
  activeTitle?: string;
  onClick(reply: ArgusChatReply): void;
}

interface ArgusChatReply {
  sessionId: string;
  markdown: string; // the reply as Claude wrote it
  // The reply as rendered: standard HTML (p, li, h1-h6, blockquote, a, code, pre, table). Code blocks are in <pre>,
  // diagrams in <svg>. Read it, don't change it: the chat may redraw it.
  element: HTMLElement;
  // A floating layer at the bottom right of this chat's transcript, outside its scroll area, for controls that should
  // stay in view. It goes away when the chat closes or shows another session: check isConnected.
  overlay: HTMLElement;
  // Shows activeIcon / activeTitle on this reply's button and keeps it visible without hover.
  setActive(active: boolean): void;
}

interface ArgusChatExtensionModule {
  mount(ctx: ArgusChatContext): void;
  onMessage?(message: unknown): void; // from ChatExtensionHandle.post() or onMessage's reply()
}

interface Window {
  argusChat: {
    registerExtension(id: string, extension: ArgusChatExtensionModule): void;
  };
}
