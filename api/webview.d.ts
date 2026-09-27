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
//   ("5m", "2h 3m"); add data-precise="true" for "4m 07s".
// - Spinner: elements with class "glyph spin" animate.

interface ArgusWebviewContext {
  post(message: unknown): void; // to ArgusTab.onMessage in the plugin extension
  esc(value: unknown): string; // HTML-escapes String(value); null and undefined become ""
  elapsed(sinceMs: number): string;
  elapsedPrecise(sinceMs: number): string;
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
