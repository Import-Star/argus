---
title: Privacy and files
nav_order: 8
---

# Privacy and files

Argus is local-only. It has no telemetry.

| Path | Purpose |
| --- | --- |
| `~/.claude/settings.json` | "Set Up Session Tracking" adds hook entries; "Remove Session Tracking" removes them. A `.bak` copy is written first. |
| `~/.claude/argus/session-tracker.ts` | The hook script, copied out of the extension so updates never break the path in settings. Argus replaces it with its own version on startup once tracking is set up, unless a newer Argus wrote it (`~/.claude/argus/package.json` records the version). |
| `~/.claude/argus/plugins/` | Plugin folders, loaded on startup. Argus also writes `argus.d.ts` and `argus-webview.d.ts` here for plugin authors. |
| `~/.claude/argus/sessions/<id>.json` | One record per session, written by the hook on SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, Notification, Stop, SubagentStart, SubagentStop and SessionEnd. It holds prompt snippets, the last assistant message and any pending tool command in plain text. Deleted `argus.sessions.retentionDays` days after the session closes. |
| `~/.claude/sessions/<pid>.json` | Claude Code's own registry of open sessions (read only). |
| `~/.claude/projects/**/*.jsonl` | Claude Code's session and sub-agent transcripts (read only), for token use and search. Only new lines are read, kept in memory and never written anywhere. |
| `~/.claude/.credentials.json` | Claude Code sign-in (read only, while `argus.usage.enabled` is on, which is the default). Sent only to the Anthropic usage endpoint. |

Network use: `gh` calls to GitHub for PR state and PR diffs, using your existing `gh` login, and the Claude plan
usage call above, and a request to `downloads.claude.ai` for the newest Claude Code version at startup and every 4
hours. A plugin may make its own network calls; see its README.
