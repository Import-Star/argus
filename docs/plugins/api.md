---
title: API reference
nav_order: 2
parent: Plugins
---

# API reference

The plugin API is published as two type files, which Argus writes to `~/.claude/argus/plugins/` every time it
starts, so they always match the Argus you're running:

- `argus.d.ts`: the extension side, passed to your `activate(argus, context)`.
- `argus-webview.d.ts`: the webview side, `window.argus` in a tab script and `window.argusChat` in a chat extension.

`argus.version` is the API version (currently `1`). Members marked optional (`?`) are newer than version 1: call
them with `?.` so your plugin keeps working on older Argus versions.

## Extension side (`argus.d.ts`)

```ts
// Public API of the Argus core extension (importstar.argus-control-center). A plugin is a folder in
// ~/.claude/argus/plugins with an argus-plugin.json manifest; its main module exports activate(), and Argus passes
// this object in:
//
//   export async function activate(argus: ArgusApi, context: ArgusPluginContext) {
//     if (argus.version < 1) { return; }
//
// Types only: import with `import type`. The webview side of a tab is described in ./webview.d.ts.

import type * as vscode from "vscode";

// Overrides for a new Argus chat. `model` is an alias or id (e.g. "sonnet"); `cwd` is the folder it starts in.
export interface NewChatOptions {
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  cwd?: string;
}

export type SessionState = "idle" | "working" | "permission" | "question" | "done" | "ended";

export type SessionColumn = "needs-you" | "working" | "scheduled" | "pr-open" | "idle" | "archived";

// One Claude Code session as written by the session tracker hook to ~/.claude/argus/sessions/<id>.json.
export interface SessionRecord {
  sessionId: string;
  cwd: string;
  transcriptPath?: string;
  startedAt: number;
  updatedAt: number;
  stateSince: number;
  lastMessageAt?: number;
  lastPromptAt?: number;
  state: SessionState;
  title?: string;
  // "user" once set by /rename or a board rename, so the hook stops replacing it with Claude's title.
  titleSource?: "user";
  // True once the title comes from Claude or the user, not the first prompt Argus shows until then.
  titled?: boolean;
  lastPrompt?: string;
  pending?: string;
  lastMessage?: string;
  prs: string[];
  worktrees?: string[];
  // Plugin links, set when a session is started with sessions.start({ link }). Key: plugin id, value: plugin item id.
  links?: Record<string, string>;
  lastTool?: string;
  endReason?: string;
  // Sub-agents running right now, agent id to agent type. Cleared when the session restarts or ends.
  subagents?: Record<string, string>;
}

// Token use read from the session's transcript and its sub-agents' transcripts.
export interface SessionUsage {
  // Size of the latest prompt the main agent sent: roughly how full its context is.
  contextTokens?: number;
  // New input, cache writes and output, summed over every model call. Cache reads are counted separately.
  usedTokens: number;
  cacheReadTokens: number;
  compactions: number;
}

// Something that will start the session again without a prompt: a wakeup, a cron job or background work.
export interface SessionTimer {
  kind: "wakeup" | "cron" | "command" | "monitor" | "agent";
  label: string;
  since: number;
  // When it fires. Unset for background work, which wakes the session when it finishes.
  at?: number;
  // Cron schedule of a recurring job.
  schedule?: string;
}

export interface PrCheck {
  name: string;
  status: string;
  conclusion?: string;
}

export interface PrReviewer {
  login: string;
  state: string;
}

export interface PrSummary {
  key: string; // owner/repo#number
  title?: string;
  url: string; // canonical https://github.com/owner/repo/pull/number
  state: string; // OPEN | MERGED | CLOSED | unknown
  isDraft: boolean;
  closedAt?: string; // ISO time the PR was merged or closed
  reviewDecision?: string;
  reviewers: PrReviewer[];
  unresolvedThreads?: number; // review comment threads not yet resolved
  checks: PrCheck[];
  syncedAt: string;
  error?: string;
}

export interface SessionCard {
  record: SessionRecord;
  column: SessionColumn;
  repo: string;
  worktree?: string;
  open: boolean;
  name?: string;
  read: boolean;
  // The session stopped mid-turn (Esc, crash or closed tab) and needs resuming.
  interrupted: boolean;
  archivedManually: boolean;
  prs: PrSummary[];
  // Undefined until the transcript has been read; archived sessions are only read when searched.
  usage?: SessionUsage;
  // Only for open sessions, since every timer dies with the Claude process.
  timers: SessionTimer[];
}

// A small label a plugin adds to session cards in the Sessions tab, e.g. the kanban ticket a session works on.
export interface SessionChip {
  text: string;
  tooltip?: string;
  // Run when the chip is clicked. Only VS Code commands: plugins register their own.
  command?: { command: string; arguments?: unknown[] };
}

// A section a plugin adds to the Details pane beside an Argus chat. Plain data the core draws (no plugin code runs
// in the chat webview), so it follows the chat's theme. Ids are lowercase [a-z0-9-], unique within the plugin.
export interface ChatDetailsSection {
  id: string;
  title: string;
  items: ChatDetailsItem[];
}

export type ChatDetailsItem =
  // A label and a value on one line, e.g. "Client  Owl Markets".
  | { type: "row"; label: string; value: string; tooltip?: string }
  // A short muted line, e.g. where a value came from.
  | { type: "note"; text: string }
  // A dropdown. Picking an option calls the provider's onAction with the item id and the option's value.
  | { type: "select"; id: string; label: string; value: string; options: { value: string; label: string }[] }
  // A button. Pressing it calls onAction with the item id.
  | { type: "button"; id: string; label: string };

export interface ChatDetailsProvider {
  // Sections for one session's chat, asked for whenever its card changes; keep it fast.
  sections(card: SessionCard): ChatDetailsSection[] | undefined;
  // A select changed (with the option's value) or a button was pressed (no value).
  onAction?(sessionId: string, sectionId: string, itemId: string, value?: string): void | Promise<void>;
}

// A script a plugin runs inside every Argus chat webview, e.g. to add a button under Claude's replies. The webview
// side is described in ./webview.d.ts (window.argusChat). Registering or disposing one reloads open chat tabs.
export interface ArgusChatExtension {
  id: string; // unique, lowercase [a-z0-9-]
  // File URIs inside the plugin's own folder, loaded after the chat's own bundle with the webview's CSP nonce.
  script: vscode.Uri;
  style?: vscode.Uri;
  // Extra sources the chat's CSP allows for <audio> and <video>, e.g. ["data:"] to play generated audio.
  media?: ("data:" | "blob:")[];
  // A message the script sent with ctx.post(). `reply` answers the chat webview it came from.
  onMessage?(message: unknown, reply: (message: unknown) => void): void | Promise<void>;
}

export interface ChatExtensionHandle extends vscode.Disposable {
  // Sends a message to the extension's script in every open chat webview (ArgusChatExtensionModule.onMessage).
  post(message: unknown): void;
}

// One extra step offered when the user archives a session ("Archive and clean up").
export interface CleanupItem {
  label: string; // shown in the confirmation dialog, e.g. "Remove work card: Fix login"
  run(): Promise<void> | void;
}

export interface ArgusTab {
  id: string; // unique, lowercase [a-z0-9-], e.g. "kanban"
  title: string; // tab label, e.g. "Work"
  order?: number; // lower first; the core Sessions tab is 0. Default 100.
  // File URIs inside the plugin's own extension folder. The core adds their folders to the webview's
  // localResourceRoots and loads them after its own scripts, with the webview's CSP nonce.
  script: vscode.Uri;
  style?: vscode.Uri;
  // A message the tab's webview script sent with ctx.post(). Reply with handle.post().
  onMessage?(message: unknown): void | Promise<void>;
  // True while the Control Center panel is visible and this tab is the active one.
  onDidChangeVisibility?(visible: boolean): void;
}

export interface TabHandle {
  // Sends a message to the tab's webview script (ArgusWebviewTab.onMessage). Dropped while the panel is closed,
  // so tab scripts should post { type: "ready" } when mounted and the plugin should answer with full state.
  post(message: unknown): void;
  setBadge(count: number | undefined): void; // number shown on the tab, hidden when undefined or 0
  readonly visible: boolean;
  dispose(): void;
}

export interface ArgusApi {
  readonly version: 1;

  sessions: {
    // Cards for this window's scope (argus.sessions.scope), sorted by column then age.
    getCards(): readonly SessionCard[];
    readonly onDidChange: vscode.Event<readonly SessionCard[]>;
    // Opens the session in Argus chat, resuming it if needed. `draft` goes in the chat's input box, not sent.
    open(sessionId: string, options?: { draft?: string }): Promise<void>;
    // Starts a new Argus chat with the prompt. With `link`, the session's record.links[plugin] = id
    // once its first prompt is submitted (the core appends a marker the hook strips).
    // `model`, `effort` and `cwd` override the chat's defaults for this session only.
    start(options: { prompt: string; link?: { plugin: string; id: string }; viewColumn?: vscode.ViewColumn } & NewChatOptions): Promise<void>;
  };

  prs: {
    // Canonical PR URLs found in free text, de-duplicated.
    parse(text: string): string[];
    // PR state through the gh CLI, cached (argus.prs.cacheSeconds). Keyed by canonical URL; failures come back
    // as a PrSummary with `error` set. Returns an empty map when gh is unavailable.
    get(urls: readonly string[], options?: { refresh?: boolean }): Promise<Map<string, PrSummary>>;
    available(): Promise<{ ok: boolean; message?: string }>;
  };

  // Adds a tab to the Control Center. Registering while the panel is open reloads it.
  registerTab(tab: ArgusTab): TabHandle;
  // Opens the Control Center on the given tab (or the last active one).
  openControlCenter(tabId?: string): Promise<void>;
  // Chips for a session card, asked for on every render; keep it fast. Call `refresh` on the returned handle
  // when your chips change without a session change (e.g. a ticket was renamed).
  registerSessionChips(provider: (card: SessionCard) => SessionChip[] | undefined): vscode.Disposable & { refresh(): void };
  // Extra cleanup offered when a session is archived. Return [] when there is nothing to do.
  registerArchiveCleanup(provider: (card: SessionCard) => Promise<CleanupItem[]> | CleanupItem[]): vscode.Disposable;
  // Sections in the Details pane of Argus chats. Call `refresh` when they change without a session change.
  // Optional: older Argus versions don't have it, so check before calling.
  registerChatDetails?(provider: ChatDetailsProvider): vscode.Disposable & { refresh(): void };
  // A script that runs inside Argus chat webviews. Optional: older Argus versions don't have it.
  registerChatExtension?(extension: ArgusChatExtension): ChatExtensionHandle;
}

// A plugin's slice of the "argus.plugins" setting. Keys missing from settings fall back to the defaults in the
// plugin's argus-plugin.json. User and workspace scopes are merged key by key, so a workspace can override one
// key without restating the rest.
export interface PluginConfig {
  get<T>(key: string): T | undefined;
  get<T>(key: string, fallback: T): T;
  // Writes argus.plugins.<pluginId>.<key>. Target defaults to the global (user) settings file.
  update(key: string, value: unknown, target?: vscode.ConfigurationTarget): Promise<void>;
  // Fires with the keys whose values changed.
  readonly onDidChange: vscode.Event<readonly string[]>;
}

// What a locally installed plugin gets in place of vscode.ExtensionContext. Argus owns the plugin's lifetime:
// everything pushed to `subscriptions` is disposed when plugins are reloaded or Argus shuts down.
export interface ArgusPluginContext {
  readonly pluginId: string;
  subscriptions: { dispose(): unknown }[];
  // The plugin's own folder, for media files handed to ArgusTab.script / .style.
  readonly extensionUri: vscode.Uri;
  readonly extensionPath: string;
  // A folder of the plugin's own under Argus's global storage. Created before activate() is called.
  readonly globalStorageUri: vscode.Uri;
  readonly globalState: vscode.Memento;
  readonly workspaceState: vscode.Memento;
  readonly config: PluginConfig;
  // VS Code's SecretStorage (OS keychain), with keys scoped to this plugin. For tokens and passwords: never put
  // those in config. Optional so plugins can run on older Argus versions that don't provide it.
  readonly secrets?: vscode.SecretStorage;
}

// The shape of a plugin's main module (argus-plugin.json "main"). Argus requires the file and calls activate().
// Inside plugin files `import * as vscode from "vscode"` works as it does in any extension.
export interface ArgusPluginModule {
  activate(argus: ArgusApi, context: ArgusPluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
```

## Webview side (`argus-webview.d.ts`)

```ts
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
```
