---
title: Writing a plugin
nav_order: 1
parent: Plugins
---

# Writing a plugin

A plugin is a folder in `~/.claude/argus/plugins` with an `argus-plugin.json` in it. Argus finds it on startup,
loads it into its own process and calls `activate()`. There is nothing to package and nothing to install into
VS Code, and **Argus: Reload Plugins** picks up a rebuild without reloading the window.

Loading a plugin runs its code with the same access Argus has to this machine, so Argus asks once per folder
before it loads one for the first time. **Argus: Reset Plugin Trust** makes it ask again.

## Layout

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

## The manifest

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

## The entry point

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
    vscode.commands.registerCommand("argus.myPlugin.open", () => argus.openControlCenter("my-plugin"))
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

## Settings

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

## Optional extras

These work without a tab:

- `argus.registerSessionChips(card => chips)` adds a small label to session cards (e.g. a linked ticket). Called
  on every render, so keep it fast; call `.refresh()` on the returned handle when your data changes without a
  session change.
- `argus.registerArchiveCleanup(card => items)` offers extra steps when a session is archived (e.g. "remove work
  card"). Return `[]` when there is nothing to do for that card.
<a id="chat-details"></a>
- `argus.registerChatDetails?.({ sections(card), onAction(sessionId, sectionId, itemId, value) })` adds sections to
  the Details pane beside an Argus chat. Sections are plain data (`row`, `note`, `select`, `button` items) that the
  chat draws itself, so no plugin code runs in the chat webview. A select change or a button press calls `onAction`;
  call `.refresh()` on the returned handle when your sections change without a session change. It's optional on
  `ArgusApi`, so call it with `?.` to keep working on older Argus versions.
- `argus.registerChatExtension?.({ id, script, style, media, onMessage(message, reply) })` runs your script inside
  every Argus chat webview, after the chat's own bundle. The script calls `argusChat.registerExtension(id, { mount,
  onMessage })`; `ctx.addReplyAction()` puts a button beside Copy under Claude's replies, and the reply it hands you
  carries the rendered element, the markdown, `setActive()` and an `overlay` for floating controls. `media: ["data:"]`
  (or `"blob:"`) lets the script play audio or video it builds. Registering or disposing reloads open chat tabs. Types
  are in `argus-webview.d.ts`; check for it with `?.` like `registerChatDetails`.

## Start a linked session

```ts
await argus.sessions.start({
  prompt: "Fix the login bug",
  link: { plugin: "my-plugin", id: card.id }, // sets record.links["my-plugin"] = card.id once the prompt is submitted
  model: "sonnet", // optional: model, effort and cwd override the chat's defaults for this session
  effort: "high",
  cwd: "/path/to/repo"
});
```

## Developing against a checkout

Point `argus.plugins.paths` at the folder instead of copying it into `~/.claude/argus/plugins`:

```json
"argus.plugins.paths": ["~/code/argus-my-plugin"]
```

Then the loop is: edit, `npm run build`, **Argus: Reload Plugins**.

If a plugin throws on the way up, Argus logs it to the **Argus Plugins** output channel and carries on loading
the others.

## Minimal webview-side tab

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

## Rules for plugins

- Use only the [API](api.md); never import Argus's own code.
- Every Control Center webview has a strict CSP: no inline scripts, no remote scripts. Escape all interpolated text
  with `ctx.esc()`.
- Document your settings in your plugin's README: they don't appear in the Settings UI.
