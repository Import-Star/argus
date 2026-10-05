# Developing Argus

We encourage you to run Argus from source rather than only from the Marketplace. Argus is small and plain
TypeScript, so your own Claude Code agent can extend it to fit how you work: a new tab, a new session chip,
another CI provider, a different status bar item.

## Repo layout

```
package.json, src/, hooks/, skills/, media/      the core extension (importstar.argus)
api/index.d.ts                                    the plugin API (extension side)
api/webview.d.ts                                   the plugin API (webview side)
```

Plugins are not in this repo. Each one is a folder in `~/.claude/argus/plugins`, loaded by the core at startup.
See [Writing a plugin](#writing-a-plugin), and the README for the three we maintain.

## Build it

From the repo root:

```bash
npm install
npm run compile      # tsc -p ./ plus the hook's type-check
npm run package:vsix  # npx @vscode/vsce package --no-dependencies
```

A plugin builds from its own folder with `npm install && npm run build`. It is never packaged.

## Run it locally

Requirements: Node.js 24+ (the hook runs TypeScript natively), the `code` CLI on your PATH, and this repo cloned.

**1. Extension Development Host (fast loop while editing).** Open the repo folder in VS Code and press `F5` (**Run
Argus**). A second VS Code window opens with your build of the core loaded, and it loads the plugins in
`~/.claude/argus/plugins` like any other window. `npm run watch` in a terminal recompiles the core on save;
reload the host window (`Ctrl+R`) to pick up changes.

**2. Install as your daily extension.** From the repo root:

```bash
./install-local.sh      # macOS / Linux
./install-local.ps1     # Windows
```

These run `npm install`, `npm run compile` and `npm run package:vsix`, then
`code --install-extension argus-<version>.vsix --force`. Plugins are separate: clone them into
`~/.claude/argus/plugins` and build each one there.

After either script, run `Developer: Reload Window`. If you also installed Argus from the Marketplace, disable
one copy so the two do not both register the same commands.

Run **Argus: Set Up Session Tracking** once per machine. Re-run it after changing `hooks/session-tracker.ts`, because it is copied out to `~/.claude` on install.

## Working with an agent

Point your Claude Code session at the repo and it will pick up [CLAUDE.md](CLAUDE.md), which describes the
layout and the rules. A good loop:

1. Ask the agent for a change ("add a session chip for X", "write a plugin that shows Y").
2. It edits, then runs `npm run compile` (or `npm run build` in a plugin folder). Compile errors are the main
   check; there are no tests yet.
3. You press `F5` or run the install script and try it. For a plugin change, **Argus: Reload Plugins** is enough.

Ask it to keep changes small and to update the README and CHANGELOG when behaviour changes.

## Architecture

```
src/extension.ts                 activation, command registration, wiring
src/api.ts                       builds the ArgusApi object handed to plugins
src/types.ts                     shared types (session records, cards, PR summaries)
api/index.d.ts                   the same API, as the public .d.ts contract
api/webview.d.ts                 the webview-side contract for a tab
src/providers/
  SessionTreeProvider.ts          sidebar tree of sessions
  AttentionStatusBar.ts           "N need you" status bar item
  ControlCenter.ts                Control Center webview panel: hosts every registered tab
  SessionsTab.ts                  the core's own tab (Sessions, larger), built on registerTab
  UsageStatusBar.ts               Claude plan usage status bar item
src/services/
  SessionStore.ts                 merges hook records + Claude Code's session registry into cards and columns
  TranscriptIndex.ts              reads transcripts incrementally for per-card token use and transcript search
  HookInstaller.ts                edits ~/.claude/settings.json, copies the hook script
  GhPrSyncService.ts              PR state through the gh CLI, exposed to plugins as api.prs
  openSession.ts                  opens Claude Code tabs via claude-vscode.editor.open
  archiveSession.ts               archive plus plugin-supplied cleanup (registerArchiveCleanup)
  PrLinkParser.ts                 PR URL parsing, exposed as api.prs.parse
  UsageService.ts                 Claude plan usage, reads from Anthropic's OAuth endpoint
  PluginHost.ts                   finds, loads and reloads plugin folders; owns their lifetime
  PluginConfig.ts                 a plugin's slice of argus.plugins.config
hooks/session-tracker.ts         runs inside Claude Code hooks, writes session JSON
media/host.js, styles.css        Control Center webview shell: tab switching, shared CSS classes, timers
```

Data flow: Claude Code fires a hook, `session-tracker` writes `~/.claude/argus/sessions/<id>.json`,
`SessionStore` watches that directory and Claude Code's own registry, builds `SessionCard`s, and the tree, status
bar and Sessions tab all subscribe to its `onDidChange`. The Control Center webview talks to the extension with
`postMessage`; `ControlCenter.ts` routes each message to the tab it names.

## Writing a plugin

A plugin is a folder in `~/.claude/argus/plugins` with an `argus-plugin.json` in it. Argus finds it on startup,
loads it into its own process and calls `activate()`. There is nothing to package and nothing to install into
VS Code, and **Argus: Reload Plugins** picks up a rebuild without reloading the window.

Loading a plugin runs its code with the same access Argus has to this machine, so Argus asks once per folder
before it loads one for the first time. **Argus: Reset Plugin Trust** makes it ask again.

### Layout

```
my-plugin/
  argus-plugin.json      the manifest Argus reads
  package.json           a plain npm package: typescript and @types, no VS Code fields
  tsconfig.json
  src/extension.ts       exports activate(argus, context)
  out/extension.js       what "main" points at, built by npm run build
  media/my-plugin.js     the tab's webview script
  media/my-plugin.css    the tab's stylesheet (optional)
  types/argus.d.ts       a copy of the API types
```

`~/.claude/argus/plugins/argus.d.ts` and `argus-webview.d.ts` are written there by the core every time it
starts, so they always match the Argus you are running. Copy them into your plugin and refresh them with a
script of your own:

```json
"sync:types": "cp ~/.claude/argus/plugins/argus.d.ts types/argus.d.ts && cp ~/.claude/argus/plugins/argus-webview.d.ts types/argus-webview.d.ts"
```

### The manifest

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "apiVersion": 1,
  "main": "out/extension.js",
  "config": { "refreshSeconds": 30 },
  "commands": [{ "command": "argus.myPlugin.open", "title": "Argus: Open My Plugin" }]
}
```

- `id` is lowercase letters, digits and dashes, and must be unique across loaded plugins.
- `main` is relative to the folder and may not point outside it.
- `apiVersion` is the plugin API this needs. Argus skips a plugin that asks for more than it provides.
- `config` holds the default value of each setting. See [Settings](#settings).
- `commands` is what **Argus: Run Plugin Command** lists. Register each one yourself in `activate()`.

### The entry point

```ts
import * as vscode from "vscode";
import type { ArgusApi, ArgusPluginContext } from "../types/argus";

export function activate(argus: ArgusApi, context: ArgusPluginContext): void {
  const handle = argus.registerTab({
    id: "my-plugin",           // unique, lowercase [a-z0-9-]
    title: "Mine",
    order: 10,                  // lower sorts first; the core Sessions tab is 0
    script: vscode.Uri.joinPath(context.extensionUri, "media", "my-plugin.js"),
    style: vscode.Uri.joinPath(context.extensionUri, "media", "my-plugin.css"),
    onMessage(message) { /* handle a message the webview posted */ },
    onDidChangeVisibility(visible) { /* start/stop polling */ }
  });

  context.subscriptions.push(
    handle,
    vscode.commands.registerCommand("argus.myPlugin.open", () => argus.openControlCentre("my-plugin"))
  );
}

export function deactivate(): void {}  // optional
```

`import * as vscode from "vscode"` works in any file of the plugin, as it does in an extension. `deactivate()`
and everything pushed to `context.subscriptions` run when plugins are reloaded or VS Code shuts down.

`context` is an `ArgusPluginContext`, not a `vscode.ExtensionContext`: `pluginId`, `subscriptions`,
`extensionUri` and `extensionPath` (your folder), `globalStorageUri` (a folder of your own, already created),
`globalState`, `workspaceState` and `config`.

`handle.post(message)` sends to your tab's webview script; `handle.setBadge(count)` sets the number on the tab.

### Settings

A plugin's settings live under one core-owned key, in normal VS Code settings, so a user can set them per user
or per workspace and Settings Sync carries them:

```json
"argus.plugins.config": {
  "my-plugin": { "refreshSeconds": 60 }
}
```

Read them through `context.config`, which falls back to the `config` block of your manifest:

```ts
const seconds = context.config.get("refreshSeconds", 30);
context.config.onDidChange((keys) => {
  if (keys.includes("refreshSeconds")) { restartTimer(); }
});
await context.config.update("refreshSeconds", 15);
```

The user and workspace scopes are merged key by key, so a workspace can override one key without restating the
rest. Document your keys in your plugin's README: they do not appear in the Settings UI.

### Optional extras

Both work without a tab:

- `argus.registerSessionChips(card => chips)` adds a small label to session cards (e.g. a linked ticket). Called
  on every render, so keep it fast; call `.refresh()` on the returned handle when your data changes without a
  session change.
- `argus.registerArchiveCleanup(card => items)` offers extra steps when a session is archived (e.g. "remove work
  card"). Return `[]` when there is nothing to do for that card.

### Start a linked session

```ts
await argus.sessions.start({
  prompt: "Fix the login bug",
  link: { plugin: "my-plugin", id: card.id } // sets record.links["my-plugin"] = card.id once the prompt is submitted
});
```

### Developing against a checkout

Point `argus.plugins.paths` at the folder instead of copying it into `~/.claude/argus/plugins`:

```json
"argus.plugins.paths": ["~/code/argus-my-plugin"]
```

Then the loop is: edit, `npm run build`, **Argus: Reload Plugins**.

If a plugin throws on the way up, Argus logs it to the **Argus Plugins** output channel and carries on loading
the others.

### Minimal webview-side tab

`ArgusTab.script` is loaded into the Control Center webview after the core's own host script, which defines
`window.argus`. Register with the same id you used in `registerTab`:

```js
window.argus.registerTab("kanban", {
  mount(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    ctx.post({ type: "ready" }); // ask the extension for state — see the rule below
  },
  onMessage(message) {
    this.root.innerHTML = `<div class="row"><span class="title">${this.ctx.esc(message.title)}</span></div>`;
  }
});
```

Plain JS, no build step. The tab owns everything inside `root`, including its own toolbar and status line. The
CSP allows no inline scripts or event handlers: bind listeners in code, and escape every interpolated value with
`ctx.esc()`.

**CSS and class contract** (from `api/webview.d.ts`): the core stylesheet provides VS Code theme variables and
these classes, so use them instead of redefining them: `.mono`, `kbd`, `button`, `button.primary`, `button.icon`,
`button.link`, `.statusline` (`.n`, `.right`), `.row` (`.l1`, `.l2`, `.title`, `.t`, `.actions`, `.activity`),
`.glyph` (`.spin`, `.ok`, `.bad`, `.dot`), `.chips`, `.chip` (`.pr-open`, `.pr-merged`, `.pr-closed`),
`.empty-line`, `.sync-error`, `.muted`, `.badge`. Anything else goes in your own `style` stylesheet, scoped under
`[data-tab-root="<your-id>"]`. An element with class `t` and `data-since="<epoch ms>"` is re-rendered every
second as elapsed time; add `data-precise="true"` for seconds.

**The rule**: `handle.post()` is dropped while the Control Center panel is closed, so a tab script must post
`{ type: "ready" }` on mount and the extension side must answer with full state — never assume your first `post`
from the extension arrives.

[argus-kanban](https://github.com/Import-Star/argus-kanban) is the fullest example: a board webview,
`registerSessionChips`, `registerArchiveCleanup` and `sessions.start` with `link`, wired together in
`src/extension.ts` and `src/kanbanController.ts`.

## Conventions

- The hook is not compiled: Node 24 runs `hooks/session-tracker.ts` directly, so use only erasable TypeScript
  syntax (no enums, namespaces or parameter properties). `tsc` type-checks it via `tsconfig.hooks.json`. It must
  stay dependency-free and fast. It runs on every Claude Code event, so never make it slow, and never let it
  throw or write to stdout (stdout of some hooks is shown to the agent).
- `api/*.d.ts` is the public plugin contract: changes must stay backwards compatible, or bump `version` and
  `API_VERSION` in `PluginHost.ts`. The core copies both files into `~/.claude/argus/plugins` on every start.
- Plugins must only use the API, never import core code.
- Every Control Center webview has a strict CSP: no inline scripts, no remote scripts. Escape all interpolated
  text with `ctx.esc()`.
- Nothing may be specific to one company or repo. Use settings instead of constants.
- Never send or log the Claude OAuth token (relevant to `UsageService.ts`).
- Keep public behaviour in the relevant README and add a CHANGELOG entry, for the core or the plugin you changed.
  A plugin's settings only exist in its README, so a new key that is not written up is a key nobody will find.

## Publish your own build

Use this for your own fork or a private team build. Only the core is published; plugins are cloned, not
installed from the Marketplace.

1. Create a publisher at <https://marketplace.visualstudio.com/manage> and a Personal Access Token (Azure DevOps,
   scope `Marketplace > Manage`).
2. In `package.json`, set `publisher` to yours, and update `repository`, `bugs` and `homepage`.
3. Bump `version` and update `CHANGELOG.md`.
4. `npx @vscode/vsce login <publisher>` then `npm run publish:store`. To only build the file,
   `npm run package:vsix`.
5. For Open VSX (VS Code forks such as VSCodium), use `npx ovsx publish` from the same folder.

Before publishing, check the packaged file list with `npx @vscode/vsce ls` — `api/*.d.ts` must be in it, because
the core copies those out for plugin authors — and run through the README's "Getting started" steps in a clean
VS Code profile (`code --profile-temp`) to confirm a first-time user can get sessions to appear.
