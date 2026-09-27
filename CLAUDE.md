# Argus (VS Code extension)

Core: the Claude Code Sessions board (sidebar, status bar, Control Centre Sessions tab) and a plugin API. Work
(kanban), GitHub Actions and Claude plan usage are separate extensions in `plugins/`, built on that API. Plain
TypeScript compiled with `tsc`; see [DEVELOPING.md](DEVELOPING.md) for the architecture map and
[README.md](README.md) for user-facing behaviour.

## Commands

- `npm run compile` compiles the core (`src` to `out`) and type-checks the hook. Run it after every core change;
  there are no tests, so a clean compile is the check.
- `npm run compile:plugins` compiles both plugins.
- `./install-local.ps1` or `./install-local.sh` build and install the **core** extension only; they don't touch
  `plugins/`. Then reload the window.
- Each plugin packages from its own folder with `npm run package:vsix`.
- `F5` in VS Code launches an Extension Development Host running the core.

## Layout

- `src/`, `api/`, `hooks/`, `skills/`, `media/`, `package.json` at the repo root — the core extension
  (`importstar.argus`).
- `api/index.d.ts` and `api/webview.d.ts` — the plugin API, extension side and webview side.
- `plugins/kanban/`, `plugins/actions/` — the two first-party plugins, each its own extension with its own
  `package.json`, `README.md` and `CHANGELOG.md`.

## Rules

- `api/*.d.ts` is the public plugin contract: changes must stay backwards compatible or bump `version`.
- Plugins must only use the API, never import core code.
- No hardcoded company, repo, user or path values. Add a setting in the relevant `package.json`
  (`contributes.configuration`) and document it in that package's README.
- `hooks/session-tracker.ts` is run as-is by Node 24 (native type stripping): erasable TypeScript syntax only. It
  runs on every Claude Code event: keep it fast, synchronous, dependency-free, silent on stdout, and never let it
  throw. Changes need the user to re-run "Argus: Set Up Session Tracking".
- Every setting and command uses the `argus.` prefix, matching the owning package's `package.json` exactly.
- Control Centre webview code (core's `media/host.js`, `media/styles.css`, and each plugin's tab script) is plain
  JS with a strict CSP (no inline scripts). Escape interpolated text with `ctx.esc()`.
- Do not log, store or transmit the Claude OAuth token; only `src/services/UsageService.ts` reads it.
- Use `Edit`-style small changes. Update the relevant README and CHANGELOG when behaviour changes.
- Windows, macOS and Linux must all work: use `path`, `os.homedir()` and `execFile` with argument arrays, never
  shell strings.
