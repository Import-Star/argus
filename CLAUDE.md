# Argus (VS Code extension)

Core: the Claude Code Sessions board (sidebar, status bar, Control Center Sessions tab), the Claude plan usage
status bar item, and a plugin API. Plugins are not in this repo: each is a folder in `~/.claude/argus/plugins`
that the core loads on startup. Plain TypeScript compiled with `tsc`; see [DEVELOPING.md](DEVELOPING.md) for the architecture map
and [README.md](README.md) for user-facing behaviour.

## Commands

- `npm run compile` compiles the core (`src` to `out`) and type-checks the hook. Run it after every core change;
  there are no tests, so a clean compile is the check.
- `./install-local.ps1` or `./install-local.sh` build and install the extension. Then reload the window.
- `npm run package:vsix` builds the `.vsix` without installing it.
- `F5` in VS Code launches an Extension Development Host running the core, which loads the plugins already in
  `~/.claude/argus/plugins`.
- A plugin builds from its own folder with `npm run build`, then **Argus: Reload Plugins** in VS Code.

## Layout

- `src/`, `api/`, `hooks/`, `skills/`, `media/`, `package.json` at the repo root — the core extension
  (`importstar.argus`).
- `api/index.d.ts` and `api/webview.d.ts` — the plugin API, extension side and webview side.
- `src/services/PluginHost.ts` — finds, loads and reloads plugin folders. `src/services/PluginConfig.ts` — a
  plugin's slice of `argus.plugins.config`.

## Rules

- `api/*.d.ts` is the public plugin contract: changes must stay backwards compatible or bump `version`.
- Plugins must only use the API, never import core code.
- No hardcoded company, repo, user or path values. Add a setting: `contributes.configuration` for the core, or a
  key in `argus-plugin.json`'s `config` block for a plugin. Document it in that package's README.
- `hooks/session-tracker.ts` is run as-is by Node 24 (native type stripping): erasable TypeScript syntax only. It
  runs on every Claude Code event: keep it fast, synchronous, dependency-free, silent on stdout, and never let it
  throw. Changes need the user to re-run "Argus: Set Up Session Tracking".
- Every core setting and every command uses the `argus.` prefix. A plugin's settings are bare keys under
  `argus.plugins.config.<plugin-id>`; its commands still carry the `argus.` prefix.
- Control Center webview code (core's `media/host.js`, `media/styles.css`, and each plugin's tab script) is plain
  JS with a strict CSP (no inline scripts). Escape interpolated text with `ctx.esc()`.
- Do not log, store or transmit the Claude OAuth token; only `src/services/UsageService.ts` reads it.
- Use `Edit`-style small changes. Update the relevant README and CHANGELOG when behaviour changes.
- Windows, macOS and Linux must all work: use `path`, `os.homedir()` and `execFile` with argument arrays, never
  shell strings.
