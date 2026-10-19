# Changelog

First public release.

## 0.2.1

Run **Argus: Set Up Session Tracking** again after updating: the first two fixes are in the session tracking hook.

- Card titles stay in step with Claude Code, including forks and `/rename`: Argus follows whichever title Claude
  Code wrote last. Only renaming the card itself locks its title.
- Worktrees added with flags before the path (`git worktree add -q -b <branch> <path>`), or by a command running
  in the background, are now linked to their session.
- Archiving a session closes its chat's VS Code tab.
- The Control Center board keeps each column's scroll position when it redraws.

## 0.2.0

- **Argus: Import Existing Claude Chats** adds chats from Claude Code's transcripts that Argus has no record of
  (from within `argus.sessions.retentionDays`), as idle or archived. Also on the Welcome page.
- Control Center Sessions tab: multi-select cards (ctrl/⌘-click, shift-click, `x`) to archive or unarchive them in
  bulk, with one cleanup prompt for the batch.
- Welcome page, opened once after the first install and from **Argus: Welcome**: shows whether session tracking
  is set up (with a button to set it up or update it), and how to add or write plugins.
- Plugin API: `context.secrets`, VS Code's SecretStorage with keys scoped to the plugin (optional field).

## 0.1.0

- Sessions board: a sidebar view of Claude Code sessions grouped into Needs you, Working, PR open, Idle and
  Archived, a status bar item, and the Sessions tab in the Control Center. Sessions stopped mid-turn show as
  interrupted in Needs you.
- Control Center Sessions tab: columns side by side, an optional row per repo (`g`), token use and
  compaction count per card, search through transcript prompts and replies including archived sessions, and
  running sub-agents per session.
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
- Diff review built in (was the diff-review plugin): worktree and PR diffs with line comments copied back to the
  session. Syntax colours from vendored highlight.js 11.12.0 (`media/diff-review/vendor`, BSD-3-Clause).
- Argus logo (a watching eye ringed by twelve more, after Argus Panoptes) as the Marketplace icon, the activity bar
  icon and the Control Center header mark.
