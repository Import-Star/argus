# Developing Argus

We encourage you to run Argus from source rather than only from the Marketplace. Argus is small and plain
TypeScript, so your own Claude Code agent can extend it to fit how you work: a new tab, a new session chip,
another CI provider, a different status bar item.

## Repo layout

```
package.json, src/, hooks/, skills/, media/      the core extension (importstar.argus)
api/index.d.ts                                    the plugin API (extension side)
api/webview.d.ts                                   the plugin API (webview side)
plugins/kanban/                                    Work tab (importstar.argus-kanban)
plugins/actions/                                    Actions tab (importstar.argus-actions)
```

Each plugin is its own VS Code extension with its own `package.json`, `README.md`, `CHANGELOG.md` and `out/`.

## Build it

From the repo root:

```bash
npm install
npm run compile          # core: tsc -p ./ plus the hook's type-check
npm run compile:plugins   # both plugins, one after another
```

Each plugin also packages from its own folder:

```bash
cd plugins/kanban && npm run package:vsix
```

`package:vsix` is `npx @vscode/vsce package --no-dependencies`; it produces `argus-kanban-<version>.vsix` (or the
matching name for `actions`/`usage`) inside that plugin's folder. There is no root script that packages or
installs the plugins for you — see below.

## Run it locally

Requirements: Node.js 24+ (the hook runs TypeScript natively), the `code` CLI on your PATH, and this repo cloned.

**1. Extension Development Host (fast loop while editing).** Open `apps/argus` in VS Code and press `F5` (**Run
Argus**). A second VS Code window opens with your build of the core loaded. `npm run watch` in a terminal
recompiles the core on save; reload the host window (`Ctrl+R`) to pick up changes. Pick **Run Argus + plugins**
instead to load the core and both plugins together (it compiles them all first).

**2. Install as your daily extension.** From `apps/argus`:

```bash
./install-local.sh      # macOS / Linux
./install-local.ps1     # Windows
```

These scripts only build and install the **core** extension: they run `npm install`, `npm run compile` and
`npm run package:vsix` in the root, then `code --install-extension argus-<version>.vsix --force`. They do not
touch `plugins/`. To install a plugin locally, `cd` into its folder, run `npm install && npm run compile && npm
run package:vsix`, then `code --install-extension argus-<plugin>-<version>.vsix --force` yourself.

After either script, run `Developer: Reload Window`. If you also installed Argus from the Marketplace, disable
one copy so the two do not both register the same commands.

Run **Argus: Set Up Session Tracking** once per machine. Re-run it after changing `hooks/session-tracker.ts` or
`skills/argus-rename-session/SKILL.md`, because both are copied out to `~/.claude` on install.

## Working with an agent

Point your Claude Code session at `apps/argus` and it will pick up [CLAUDE.md](CLAUDE.md), which describes the
layout and the rules. A good loop:

1. Ask the agent for a change ("add a session chip for X", "write a plugin that shows Y").
2. It edits, then runs `npm run compile` (and `npm run compile:plugins` if a plugin changed). Compile errors are
   the main check; there are no tests yet.
3. You press `F5` or run the install script and try it.

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
  ControlCentre.ts                Control Centre webview panel: hosts every registered tab
  SessionsTab.ts                  the core's own tab (Sessions, larger), built on registerTab
  UsageStatusBar.ts               Claude plan usage status bar item
src/services/
  SessionStore.ts                 merges hook records + Claude Code's session registry into cards and columns
  HookInstaller.ts                edits ~/.claude/settings.json, copies the hook script and the skill
  GhPrSyncService.ts / gh.ts      PR state through the gh CLI, exposed to plugins as api.prs
  openSession.ts                  opens Claude Code tabs via claude-vscode.editor.open
  archiveSession.ts               archive plus plugin-supplied cleanup (registerArchiveCleanup)
  PrLinkParser.ts                 PR URL parsing, exposed as api.prs.parse
  UsageService.ts                 Claude plan usage, reads from Anthropic's OAuth endpoint
hooks/session-tracker.ts         runs inside Claude Code hooks, writes session JSON
skills/argus-rename-session/     the skill template installed to ~/.claude/skills
media/host.js, styles.css        Control Centre webview shell: tab switching, shared CSS classes, timers
plugins/kanban/                  Work tab plugin; the fullest example of the plugin API
plugins/actions/                 Actions tab plugin; also bundles vendor/js-yaml.min.js to parse workflow YAML
```

Data flow: Claude Code fires a hook, `session-tracker` writes `~/.claude/argus/sessions/<id>.json`,
`SessionStore` watches that directory and Claude Code's own registry, builds `SessionCard`s, and the tree, status
bar and Sessions tab all subscribe to its `onDidChange`. The Control Centre webview talks to the extension with
`postMessage`; `ControlCentre.ts` routes each message to the tab it names.

## Writing a plugin

A plugin is an ordinary VS Code extension. To use the Argus API:

**1. Declare the dependency**, so VS Code activates Argus first and your extension fails gracefully without it:

```json
"extensionDependencies": ["importstar.argus"]
```

**2. Get the API in `activate()`:**

```ts
import type { ArgusApi } from "../../../api"; // or wherever api/ sits relative to your plugin

const extension = vscode.extensions.getExtension<ArgusApi>("importstar.argus");
const api = await extension?.activate();
if (!api || api.version < 1) {
  return; // Argus is missing or too old
}
```

**3. Add a tab with `registerTab`:**

```ts
const handle = api.registerTab({
  id: "kanban",              // unique, lowercase [a-z0-9-]
  title: "Work",
  order: 10,                  // lower sorts first; the core Sessions tab is 0
  script: vscode.Uri.joinPath(context.extensionUri, "media", "kanban.js"),
  style: vscode.Uri.joinPath(context.extensionUri, "media", "kanban.css"),
  onMessage(message) { /* handle a message the webview posted */ },
  onDidChangeVisibility(visible) { /* start/stop polling */ }
});
context.subscriptions.push(handle);
```

`handle.post(message)` sends to your tab's webview script; `handle.setBadge(count)` sets the number on the tab.

**4. Optional extras**, both usable without a tab:

- `api.registerSessionChips(card => chips)` adds a small label to session cards (e.g. a linked ticket). Called on
  every render, so keep it fast; call `.refresh()` on the returned handle when your data changes without a
  session change.
- `api.registerArchiveCleanup(card => items)` offers extra steps when a session is archived (e.g. "remove work
  card"). Return `[]` when there is nothing to do for that card.

**5. Start a linked session** with `api.sessions.start`:

```ts
await api.sessions.start({
  prompt: "Fix the login bug",
  link: { plugin: "kanban", id: card.id } // sets record.links.kanban = card.id once the prompt is submitted
});
```

### Minimal webview-side tab

`ArgusTab.script` is loaded into the Control Centre webview after the core's own host script, which defines
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

**The rule**: `handle.post()` is dropped while the Control Centre panel is closed, so a tab script must post
`{ type: "ready" }` on mount and the extension side must answer with full state — never assume your first `post`
from the extension arrives.

`plugins/kanban` is the fullest example: a board webview, `registerSessionChips`, `registerArchiveCleanup`, and
`sessions.start` with `link`, all wired together in `src/extension.ts` and `src/kanbanController.ts`.

## Conventions

- The hook is not compiled: Node 24 runs `hooks/session-tracker.ts` directly, so use only erasable TypeScript
  syntax (no enums, namespaces or parameter properties). `tsc` type-checks it via `tsconfig.hooks.json`. It must
  stay dependency-free and fast. It runs on every Claude Code event, so never make it slow, and never let it
  throw or write to stdout (stdout of some hooks is shown to the agent).
- `api/*.d.ts` is the public plugin contract: changes must stay backwards compatible, or bump `version`.
- Plugins must only use the API, never import core code.
- Every Control Centre webview has a strict CSP: no inline scripts, no remote scripts. Escape all interpolated
  text with `ctx.esc()`.
- Nothing may be specific to one company or repo. Use settings instead of constants.
- Never send or log the Claude OAuth token (relevant to `UsageService.ts`).
- Keep public behaviour in the relevant README and add a CHANGELOG entry, for the core or the plugin you changed.

## Publish your own build

Use this for your own fork or a private team build. Core and each plugin publish separately, as separate
Marketplace listings.

1. Create a publisher at <https://marketplace.visualstudio.com/manage> and a Personal Access Token (Azure DevOps,
   scope `Marketplace > Manage`).
2. In the core's `package.json`, and in each plugin's `package.json` you're publishing, set `publisher` to
   yours, and update `repository`, `bugs` and `homepage`.
3. Bump `version` (core and/or plugin), update the matching `CHANGELOG.md`.
4. From that package's own folder: `npx @vscode/vsce login <publisher>` then `npm run publish:store` (core) or
   `npx @vscode/vsce publish --no-dependencies` (a plugin, which has no `publish:store` script). To only build the
   file, `npm run package:vsix`.
5. For Open VSX (VS Code forks such as VSCodium), use `npx ovsx publish` from the same folder.

Before publishing, check the packaged file list with `npx @vscode/vsce ls` (run inside the folder you're
publishing) and run through the README's "Getting started" steps in a clean VS Code profile (`code
--profile-temp`) to confirm a first-time user can get sessions to appear.
