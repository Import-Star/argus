---
title: Plan usage and keep awake
parent: Features
nav_order: 7
---

# Plan usage and keep awake

## Claude plan usage

A status bar item shows your Claude plan usage as a percentage (amber at 75%, red at 90%). It is on by default;
turn it off with `argus.usage.enabled`. **Argus: Show Claude Plan Usage** shows the details and **Argus: Refresh
Claude Plan Usage** refreshes it now.

It reads the sign-in that Claude Code stores locally (`~/.claude/.credentials.json`, or the macOS keychain) and
sends it only to Anthropic's undocumented usage endpoint (`https://api.anthropic.com/api/oauth/usage`). The token is
not stored, cached or logged. Usage refreshes every `argus.usage.refreshMinutes` minutes (default 5). Check
Anthropic's terms on using your Claude subscription sign-in with third-party tools.

## Keep awake

`argus.keepAwake.mode` stops the machine sleeping while agents work:

| Mode | Behaviour |
|---|---|
| `off` | The default. |
| `on` | Keeps the machine awake until you turn it off. |
| `auto` | Only while a session in this window is working or scheduled, and for 2 minutes after. |

When it isn't `off`, an **Awake** button in the chat header switches it; **Argus: Keep Machine Awake…** does too. A
**☕ Awake** status bar item shows while it's holding. It uses a Windows power request, `caffeinate` on macOS or
`systemd-inhibit` on Linux, held by a child process that exits with VS Code. `argus.keepAwake.keepScreenOn` (on by
default) keeps the screen on too, which Windows laptops with Modern Standby need. Closing the lid still sleeps the
machine.
