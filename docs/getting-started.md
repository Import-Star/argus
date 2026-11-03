---
title: Getting started
nav_order: 2
---

# Getting started

## Requirements

- VS Code 1.90 or newer.
- [Claude Code](https://code.claude.com/docs/en/setup) installed and signed in, so `claude` runs. Argus offers to
  install it if it's missing (**Argus: Install or Update Claude Code**). Argus chat runs it through the Agent SDK.
  The Claude Code VS Code extension isn't needed.
- [Node.js](https://nodejs.org) 24 or newer. The session tracker hook is a TypeScript file that Node runs natively.
- Optional: `git`, for worktrees and diff review.
- Optional: the [GitHub CLI](https://cli.github.com) (`gh`), signed in, for PR status and PR diffs.

Argus also reads the session registry Claude Code keeps at `~/.claude/sessions/<pid>.json`. That file is not a
documented public API and may change.

## Set up

1. Install [Argus from the Marketplace](https://marketplace.visualstudio.com/items?itemName=importstar.argus-control-center).
2. On first install Argus opens its **Welcome** page, which shows whether session tracking is set up and how to add
   plugins. Click **Set Up Session Tracking** there, or run **Argus: Set Up Session Tracking** from the command
   palette (or click the link in the empty Sessions view). This installs the Claude Code hooks Argus needs; no
   sessions appear without it. See [Session tracking](session-tracking.md).
3. Start a chat with **Argus: New Chat**, or start or resume a Claude Code session anywhere. It appears in the Argus
   sidebar after its first prompt. Sessions that were already open show up once they next fire a hook.
4. To add earlier chats now, run **Argus: Import Existing Claude Chats**. It reads Claude Code's transcripts from
   the last `argus.sessions.retentionDays` days and adds any chat Argus has no record of, as idle or archived.

If Claude Code isn't installed, Argus says so at startup and when a chat can't start. **Install Claude Code** runs
Anthropic's official installer in a terminal (`irm https://claude.ai/install.ps1 | iex` on Windows,
`curl -fsSL https://claude.ai/install.sh | bash` elsewhere), then opens `claude` once so you can sign in.

## Uninstalling

Uninstalling the extension removes the hook entries from `~/.claude/settings.json` automatically, the same as
running **Argus: Remove Session Tracking** first. Your session records under `~/.claude/argus/sessions` are kept.
