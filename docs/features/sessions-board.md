---
title: Sessions board
parent: Features
nav_order: 1
---

# Sessions board

A sidebar view (the Argus icon in the activity bar) groups your Claude Code sessions into columns. Cards move on
their own as session state changes.

| Column | What's in it |
|---|---|
| **Needs you** | A permission request, a question, a finished reply you haven't read, or a session stopped mid-turn (shown as **interrupted**). |
| **Working** | Claude is running a turn. |
| **Scheduled** | Waiting on a wakeup, a cron job, or a background command, Monitor or agent. Cards show timer badges. Only open sessions, and only timers set since their Claude process started. |
| **PR open** | The session opened a PR that's still open, or one merged or closed after its last prompt. |
| **Idle** | Nothing happening. |
| **Archived** | Done: see [Archiving](#archiving). |

- The activity bar badge counts sessions that need you. A status bar item shows how many there are and the longest
  wait; click it to jump to one (or run **Argus: Sessions Needing You**).
- Open a session from its card: it opens in [Argus chat](chat.md), resuming the session.
- Each VS Code window shows only its own sessions: those started in the window's workspace folders, or in any
  checkout or worktree of the same git repo. Set `argus.sessions.scope` to `folder` in a window's Workspace settings
  to show only that window's folders, or `all` to see every session in every window. A window with no folder open
  shows everything.
- A card's title is the session's first prompt until Claude names it. Double-click the title (or use **Rename
  Chat**) to rename it in Argus. Claude Code's `/rename` also works, and changes the name in `/resume` and for other
  sessions too. Once you rename a card, Argus keeps that name.
- Cards show open PRs with their checks, review decision and unresolved review comments (`💬 2`). A
  `+ 2 merged · 1 closed` chip shows the merged and closed ones too; click it again to hide them.
- Worktree and [diff review](review.md) links are in the chat's details pane, not on the card.

## Keyboard

| Key | Action |
|---|---|
| `/` | Search |
| `j` / `k` | Move between cards |
| `Enter` | Open |
| `e` | Archive |
| `x` | Select for bulk actions |
| `Esc` | Clear the selection |
| `n` | New chat |
| `g` | Group by repo (Control Center) |

## Archiving

A session archives itself when every PR it created is merged or closed, or when it closes without making a PR. You
can also archive by hand. When the session has worktrees, archiving offers to remove them, shows how many
uncommitted files each one has, and offers a force removal that deletes those files. Installed plugins can add
their own cleanup steps; you are asked first. Archiving closes the session's Argus chat. Sending a new prompt to an
archived session brings it back.

## Notifications

A warning when a session needs permission or asks a question, and an info message when it finishes. The **Open
Session** button jumps straight to the session. No popup shows for a session whose chat is already in front of
you. Set `argus.notifications` to `input` (permission and questions only) or `off`.
