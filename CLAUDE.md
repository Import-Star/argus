# Argus (VS Code extension)

Core: the Claude Code Sessions board (sidebar, status bar, Control Center Sessions tab), Argus chat (a chat panel
running Claude Code through the Agent SDK), diff review, the Claude plan usage status bar item, and a plugin API.
Plugins are not in this repo: each is a folder in `~/.claude/argus/plugins` that the core loads on startup.
[DEVELOPING.md](DEVELOPING.md) has the architecture map, [README.md](README.md) the user-facing behaviour.

## Commands

- `npm run compile` builds everything: `tsc` for `src` to `out`, a type-check of the hook, and the esbuild chat
  bundles. `npm test` runs `test/*.test.ts` with `node --test`. Run both after every change.
- `npm run snapshots` renders the Sessions board, Settings and chat webviews from `test/fixtures/snapshots/*.json`
  to `out/snapshots/*.png` with Playwright. Run it after `npm run compile` and look at the PNG to check a UI change;
  add fields to a fixture to show new UI.
- `./install-local.sh` (or `.ps1`) builds and installs the extension over the user's copy; then reload the window.
- A plugin builds from its own folder with `npm run build`, then **Argus: Reload Plugins**.

## Layout

- `src/` — the extension host: `extension.ts` wires everything, `services/` holds the logic, `providers/` the views
  and status bar items, `diffReview/` diff review.
- `chat/host/` (Node) and `chat/webview/` (Preact) — Argus chat, bundled by `scripts/build-chat.mjs`.
- `media/` — Control Center webview scripts and CSS (plain JS). `hooks/session-tracker.ts` — the Claude Code hook.
- `api/index.d.ts` and `api/webview.d.ts` — the plugin API, extension side and webview side.
- `src/services/PluginHost.ts` — finds, loads and reloads plugin folders.

## Tests

- Add a test only when it earns its place, e.g. it guards logic that could regress quietly. Skip tests that
  restate the code or only check wiring.
- Tests can't import `vscode`, so keep testable logic in modules that don't.

## Releases

- A release is a `chore: release X.Y.Z` PR that bumps `version` in `package.json` and `package-lock.json` and turns
  `## Unreleased` in `CHANGELOG.md` into `## X.Y.Z`, then an annotated `vX.Y.Z` tag on main after it merges.
- Never create a GitHub release (`gh release create`) or attach a `.vsix` to one. Tags are the only release record.
- Publish to the VS Code Marketplace from the tag with `npm run publish:store` only when asked. A tagged version is
  released: later changes go under `## Unreleased` (add the heading if it's missing), never into a version heading.

## Rules

- `api/*.d.ts` is the public plugin contract: changes must stay backwards compatible, or bump `API_VERSION` in
  `PluginHost.ts`.
- Plugins must only use the API, never import core code.
- No hardcoded company, repo, user or path values. Add a setting: `contributes.configuration` for the core, or a
  key in `argus-plugin.json`'s `config` block for a plugin. Document it in that package's README.
- `hooks/session-tracker.ts` is run as-is by Node 24 (native type stripping): erasable TypeScript syntax only. It
  runs on every Claude Code event: keep it fast, synchronous, dependency-free, silent on stdout, and never let it
  throw. Argus copies a changed script to `~/.claude/argus` on startup by itself; adding an event to `EVENTS` in
  `HookInstaller.ts` needs the user to re-run "Argus: Set Up Session Tracking", which Argus prompts for.
- Every core setting and every command uses the `argus.` prefix. A plugin's settings are bare keys under
  `argus.plugins.config.<plugin-id>`; its commands still carry the `argus.` prefix.
- Control Center webview code (`media/host.js`, `media/sessions.js`, `media/settings.js` and each plugin's tab
  script) is plain JS with a strict CSP (no inline scripts). Escape interpolated text with `ctx.esc()`.
- Do not log, store or transmit the Claude OAuth token; only `src/services/UsageService.ts` reads it.
- Update the relevant README and CHANGELOG when behaviour changes. List any new network call in the README's
  Network use line.
- Windows, macOS and Linux must all work: use `path`, `os.homedir()` and `execFile` with argument arrays, never
  shell strings.
