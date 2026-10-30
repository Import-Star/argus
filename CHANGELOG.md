# Changelog

First public release.

## Unreleased

- **Ask aside** no longer comes back blank on a session that had a finished background task waiting: it skips the
  empty result the CLI replays on resume and waits for the real answer. An empty answer now says so.
- **Keep awake while agents run**: turn on `argus.keepAwake.whileAgentsRun` and Argus stops the machine sleeping
  while any session in the window is working or scheduled, releasing 2 minutes after the last one stops. It uses a
  Windows power request, `caffeinate` on macOS or `systemd-inhibit` on Linux, held by a child process that exits
  with VS Code. `argus.keepAwake.keepScreenOn` (on by default) keeps the screen on too, which Windows Modern Standby
  laptops need. A **☕ Awake** status bar item shows while it's holding.
- Argus chat runs slash commands that the Claude Code SDK leaves out, because the CLI only has them in its own
  terminal screen: `/remote-control` (`/rc`), `/chrome` (Claude in Chrome), `/add-dir`, `/permissions`, `/hooks`,
  `/memory`, `/agents`, `/resume`, `/login`, `/logout` and `/plugin`. They show in the `/` menu. The header shows
  **Remote Control** and **Chrome** while those are on.
- Argus chats follow Claude Code's `remoteControlAtStartup` setting and `/chrome` **Enabled by default**. SDK
  sessions used to ignore both.

## 0.6.0

- Plugin API: `registerChatDetails` adds sections to the Details pane beside an Argus chat, drawn by the chat from
  plain data (rows, notes, a dropdown, buttons), with `onAction` for picks and presses. Optional on `ArgusApi`.
- No permission or question popup for a session whose chat is already in front of you; the chat shows the prompt.
- Questions in Argus chat: answered questions fold to one line with **Change**, options are numbered tiles with a
  **Recommended** tag, "Something else" is answered inline, and each answer can carry a note. Keys 1–9, ↑↓, Enter
  and Esc work. Once answered, the transcript shows a summary of the answers and notes.
- Question options on board cards show as pills, with descriptions on hover.
- Code-review findings (`ReportFindings`) show as a findings card in Argus chat: each finding's file and line (click
  to open), summary and failure scenario. They used to show only the tool name.

## 0.5.0

- **Argus chat is now how sessions open**, and no longer needs turning on: the `argus.chat.enabled` setting is gone.
  Opening a card, **New Chat** and notification buttons all open Argus chat. Argus no longer uses the Claude Code
  VS Code extension; it runs your installed `claude` directly.
- Archiving closes the session's Argus chat. Argus no longer looks for or closes Claude Code extension tabs.
- A finished reply counts as read when its Argus chat is in front of you, instead of when a Claude Code tab is.
- Opening a session that is still running elsewhere (a terminal, say) warns that two processes would share its
  transcript.
- **Argus: Install Claude Code**: when `claude` isn't installed, Argus offers to run Anthropic's official installer in
  a terminal, then opens `claude` once so you can sign in. Argus asks at startup (once per version) and whenever a
  chat can't start. It no longer falls back to the copy of `claude` inside the Claude Code extension.
- Review's **This session** and **Last turn**, and the changed files in a chat's details pane, find changes in a git
  repo nested inside the session's folder (or outside it) by diffing each file in its own repo. They used to show
  no changes for those files.
- **Changed files** in the details pane start collapsed.
- The **Text only** button has a solid background, so chat text no longer shows through it.
- Argus chat draws ` ```mermaid ` blocks as diagrams (Mermaid 12.2.0, strict security level), with **Show source**
  to switch to the code. A block that doesn't parse stays as code with the error shown. Mermaid loads only when a
  reply has a diagram; it adds about 1.4 MB to the extension download.

## 0.4.2

- Argus keeps the session tracking hook up to date by itself: after an update it replaces the hook script in
  `~/.claude/argus` on startup, so there's no need to run **Set Up Session Tracking** again. It never replaces a
  script written by a newer Argus.
- When session tracking does need you (it's off, a new Argus hooks more events, or the Node it was set up with is
  gone), the Sessions sidebar and the Control Center show a warning with a **Set Up Session Tracking** button, and
  a broken setup gets one notification per Argus version. Removing tracking on purpose turns the warning off.

## 0.4.1

- Argus chat on Windows: files a session edited show relative to the project in Details and Review, and files
  dropped from Explorer attach with their real path.
- A chat whose Claude process ended or crashed starts a new one, resuming the session, when you send the next
  message. It used to stay on "working" and drop the message.
- Review: unchanged lines after a file's last change show the right old-side line numbers when expanded.
- With chat on, archiving a session open in a Claude Code tab closes that tab instead of asking to open the session
  in Argus chat.
- A reply that finishes while its Claude Code tab is in front of you counts as read, so the card no longer stays in
  **Needs you** after the session ends.
- Argus chat looks up each worktree's branch at most every 10 seconds instead of on every board refresh, which could
  stall VS Code with several chats open.
- Chats keep their Scheduled timers between turns before Claude Code lists them as open.
- The board's refresh spinner stops when a PR lookup fails.
- The Control Center tab shows the Argus icon, like the chat and Welcome tabs.

## 0.4.0

Run **Argus: Set Up Session Tracking** again after updating: the session tracking hook changed.

- A **Settings** tab in the Control Center for every Argus setting, including the chat ones, with a toggle,
  dropdown or field for each, **Reset**, and a note when a workspace setting overrides the value. New command:
  **Argus: Settings**.
- **Argus chat (beta, off by default).** Turn on `argus.chat.enabled` to open Claude Code sessions in Argus's own
  chat panel instead of the Claude Code extension's tab. It runs your installed `claude` through the Claude Agent
  SDK, so sessions, settings and hooks are the same ones Claude Code uses. Permission prompts, questions and plan
  approvals show in the chat. New commands: **Argus: New Chat** and **Argus: Open Chats Side by Side**. New
  setting `argus.chat.claudePath`. New chats take model, effort and permission mode from Claude Code's own settings.
- With chat on, Control Center Sessions cards waiting on a permission or question from an Argus chat can be
  answered in place (**Allow once**, **Deny**, or pick an option and **Send answer**), and **add to grid** puts a
  card's chat in the side-by-side view.
- In a chat: **Rewind to here** restores files and the conversation to a message; **Fork from here** starts a new
  chat from any message; search with Cmd/Ctrl+F, including folded tool output; **Ask aside** (Cmd/Ctrl+;) asks a
  side question without touching the transcript; a queue to edit, reorder or send queued messages now; cost per
  turn under each reply; copy buttons on code blocks and replies; a `/` slash command menu; and pasting or dropping
  files. The details pane shows plan usage, background shells, monitors and agents (with output and stop), and the
  worktrees linked to the session.
- Review changes over a chat: This session, All vs main, Last turn, Uncommitted and PR tabs, with line comments sent
  to Claude. Unchanged lines expand on click. PR diffs are read from your local clone, with `gh` as the fallback.
  Diff chips on Sessions cards open this review; the **Argus: Review Worktree Diff** command is removed.
- A chat's name is sent to Claude Code with `/rename`, so `/resume` and other sessions show the same title.
- Chats with no open tab keep running until idle for `argus.chat.backgroundIdleMinutes` (default 60), so timers
  keep firing. A reply that finished after its tab closed still shows in Needs you.
- New settings: `argus.chat.textOnlyDefault` opens chats in Text only, and `argus.chat.hiddenModels` leaves models
  out of the model picker. The Settings tab has a search box.
- No "has finished" popup for a chat whose tab is already in front of you.
- **Agents (experimental).** Turn on `argus.chat.experimentalMultiAgent` for **+ Agent** in a chat header, which
  starts another chat in the same folder and opens the group side by side. The group shares one Sessions card: it
  sits in its most urgent member's column, lists each agent, and a click opens them all in the grid. Archiving the
  card archives every agent. With the setting off, forks open in their own tab and each agent has its own card.
- Sessions cards stay in the PR column while a PR merged or closed after the last prompt, so newly finished work is
  easy to spot. The board's refresh button spins while PR states refresh.
- Sessions cards no longer show the context, used and compacted token line.

## 0.3.0

- A **Scheduled** column and timer badges for sessions waiting on a wakeup, a cron job, or a background command,
  Monitor or agent. Timers come from the transcript and count only for open sessions, from when the Claude process
  started. Open columns now share the board's width evenly.
- Opening a chat's tab directly, not through Argus, marks a needs-you session as read.

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
