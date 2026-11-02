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
  `## Unreleased` in `CHANGELOG.md` into `## X.Y.Z`. Don't tag it by hand: the publish workflow makes the tag.
- Publish only when asked: after the release PR merges, run **Publish to Marketplace** (`.github/workflows/publish.yml`)
  from `main` and approve the `marketplace` environment. It stops before doing anything unless `package.json` has a
  version higher than the last `v*` tag, `package-lock.json` matches and `CHANGELOG.md` has its `## X.Y.Z` heading.
  It then publishes with Trusted Publishing (`vsce publish --oidc`, no stored token), creates the annotated `vX.Y.Z`
  tag and a GitHub release with that CHANGELOG section as notes and the `.vsix` attached. Never create releases or
  tags by hand. Tick `dry_run` to only build the `.vsix`. `npm run publish:store` is a local fallback until the Azure
  DevOps PATs end on 2026-12-01.
  A tagged version is released: later changes go under `## Unreleased` (add the heading if it's missing), never into
  a version heading.
- Every pull request runs **CI** (`.github/workflows/ci.yml`: `npm ci`, `npm run compile`, `npm test` on Windows,
  macOS and Linux). All three must pass before it can merge. Run `npm run compile` locally too: `npm test` alone
  doesn't type-check the chat webview.
- Claude reviews a pull request when the maintainer comments `/claude-review` on it
  (`.github/workflows/claude-review.yml`). It reads this file, so keep the rules below current. It needs the Claude
  GitHub App on the repo, the `CLAUDE_CODE_OAUTH_TOKEN` secret and the `CLAUDE_REVIEWER` variable.

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
- Do not log, store or transmit the user's local Claude OAuth token (the CI review's `CLAUDE_CODE_OAUTH_TOKEN` secret
  is separate); only `src/services/UsageService.ts` reads it.
- Update the relevant README and CHANGELOG when behaviour changes. List any new network call in the README's
  Network use line.
- Windows, macOS and Linux must all work: use `path`, `os.homedir()` and `execFile` with argument arrays, never
  shell strings.
