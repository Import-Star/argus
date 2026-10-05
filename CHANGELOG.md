# Changelog

Nothing has been published yet. This is the plan for the first public release.

## 0.1.0

- Sessions board: a sidebar view of Claude Code sessions grouped into Needs you, Working, PR open, Idle and
  Archived, a status bar item, and the Sessions tab in the Control Centre. Sessions stopped mid-turn show as
  interrupted in Needs you.
- Control Centre Sessions tab: columns side by side (the inline grid style was blocked by the webview CSP, so
  they used to stack), an optional row per repo (`g`), token use and compaction count per card, search through
  transcript prompts and replies including archived sessions, and running sub-agents per session.
- **Argus: Set Up Session Tracking** installs the hooks; **Argus: Remove Session Tracking** removes them.
  Uninstalling the extension does the same automatically.
- Session titles come from the first prompt, or from Claude Code's `/rename` once you use it, so Argus, `/resume`
  and other sessions all show the same name. Set Up Session Tracking removes the `argus-rename-session` skill
  that earlier builds installed.
- Notifications with an **Open Session** button appear in VS Code when a session needs attention, configurable with
  `argus.notifications`.
- PR status for sessions through the `gh` CLI, exposed to plugins as `api.prs`.
- A plugin API (`api/index.d.ts`, `api/webview.d.ts`): `registerTab`, `registerSessionChips`,
  `registerArchiveCleanup`, and `sessions.start` with a `link` back to a plugin's own item.
- Claude plan usage in the status bar (on by default); turn off with `argus.usage.enabled`. Reads the Claude Code
  sign-in from `~/.claude/.credentials.json` (or macOS keychain) and sends it only to Anthropic's undocumented
  usage endpoint.
- Plugins load from `~/.claude/argus/plugins` instead of installing as separate VS Code extensions. A plugin is a
  folder with an `argus-plugin.json` and a built entry point; **Argus: Reload Plugins** picks up a rebuild without
  reloading the window, and `argus.plugins.paths` loads one straight from a checkout. Argus asks once per folder
  before loading a plugin for the first time.
- Plugin settings live under `argus.plugins.config`, keyed by plugin id, with defaults from the plugin's manifest.
- The core writes `argus.d.ts` and `argus-webview.d.ts` into the plugins folder on every start, so a plugin can be
  type-checked against the Argus it runs on.
- Work (kanban), GitHub Actions and PR Reviews moved out of this repo into their own repositories, each built on
  the plugin API.
- Argus logo (a watching eye ringed by twelve more, after Argus Panoptes) as the Marketplace icon, the activity bar
  icon and the Control Centre header mark.
