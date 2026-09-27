# Changelog

Nothing has been published yet. This is the plan for the first public release.

## 0.1.0

- Sessions board: a sidebar view of Claude Code sessions grouped into Needs you, Working, PR open, Idle and
  Archived, a status bar item, and the Sessions tab in the Control Centre.
- **Argus: Set Up Session Tracking** installs the hooks and the `argus-rename-session` Claude Code skill, which a
  session uses to title itself and link a worktree; **Argus: Remove Session Tracking** removes both. Uninstalling
  the extension does the same automatically.
- Notifications with an **Open Session** button appear in VS Code when a session needs attention, configurable with
  `argus.notifications`.
- PR status for sessions through the `gh` CLI, exposed to plugins as `api.prs`.
- A plugin API (`api/index.d.ts`, `api/webview.d.ts`): `registerTab`, `registerSessionChips`,
  `registerArchiveCleanup`, and `sessions.start` with a `link` back to a plugin's own item.
- Claude plan usage in the status bar (on by default); turn off with `argus.usage.enabled`. Reads the Claude Code
  sign-in from `~/.claude/.credentials.json` (or macOS keychain) and sends it only to Anthropic's undocumented
  usage endpoint.
- Work (kanban) and GitHub Actions split out into separate plugin extensions (`importstar.argus-kanban`,
  `importstar.argus-actions`), each built on the plugin API.
- Argus logo (a watching eye ringed by twelve more, after Argus Panoptes) as the Marketplace icon, the activity bar
  icon and the Control Centre header mark.
