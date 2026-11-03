---
title: Session tracking
nav_order: 3
---

# Session tracking

Argus learns about sessions through [Claude Code hooks](https://code.claude.com/docs/en/hooks). **Argus: Set Up
Session Tracking** adds a hook for each of these events to `~/.claude/settings.json`: SessionStart,
UserPromptSubmit, PreToolUse, PostToolUse (Bash), PermissionRequest, Notification, Stop, SubagentStart,
SubagentStop and SessionEnd. A `.bak` copy of the settings file is written first.

Each hook runs `~/.claude/argus/session-tracker.ts` with Node 24, which writes the session's state to
`~/.claude/argus/sessions/<id>.json`. Argus watches that folder and Claude Code's own session registry, and builds
the board from both.

## Keeping it up to date

The hook script is copied out of the extension, so updating Argus never breaks the path in your settings. On
startup and whenever the window regains focus, Argus replaces the copy with its own version once tracking is set
up. It never replaces a script that a newer Argus wrote (`~/.claude/argus/package.json` records the version).

When tracking needs you, the Sessions sidebar and the Control Center show a warning with a **Set Up Session
Tracking** button:

| Warning | When |
|---|---|
| Session tracking is off | No Argus hooks in `~/.claude/settings.json`. |
| Session tracking needs updating | A newer Argus hooks more events than your setup has. |
| Can't find the Node it was set up with | The Node path in the hook commands no longer exists. |

The last two also show one notification per Argus version. Removing tracking on purpose turns the warning off.

## Removing it

**Argus: Remove Session Tracking** removes the hook entries (after a `.bak` copy) and the hook script. Session
records, the board state and plugins are kept.
