---
title: Argus chat
parent: Features
nav_order: 3
---

# Argus chat

Sessions open in Argus's own chat panel. It runs your installed `claude` through the
[Claude Agent SDK](https://docs.claude.com/en/docs/agent-sdk/overview), so it uses your existing Claude Code
sign-in, settings and hooks. Sessions started in a terminal still appear on the board; opening one while it is
running there warns you first, since two processes would write to one transcript.

- **Argus: New Chat** starts a chat. Opening a card from the board resumes its session in the chat.
- New chats take their model, effort and permission mode from your Claude Code settings (`model`, `effortLevel`,
  `permissions.defaultMode`); a reopened chat keeps the model and effort last picked in it. Pickers in the message
  box change them for one chat.
- Permission requests, questions and plan approvals appear inline in the chat, and on the chat's
  [board card](control-center.md#sessions-tab).
- A chat's name is sent to Claude Code with `/rename`, so `/resume` and other sessions show the same title.

## Working in a chat

- **Rewind to here** restores files and the conversation to a message. **Fork from here** starts a new chat from it.
- Cmd/Ctrl+F searches the transcript, folded tool output included.
- **Ask aside** (Cmd/Ctrl+;) asks a side question without adding it to the transcript.
- Queued messages can be edited, reordered or sent now.
- Each reply shows its turn's cost, and code blocks and replies have copy buttons.
- Type `/` for the session's slash commands (see [Slash commands](slash-commands.md)), and paste or drop files to
  attach them.
- **Text only** hides tool calls and shows just the conversation. `argus.chat.textOnlyDefault` opens every chat
  that way; each chat remembers its own toggle.
- ` ```mermaid ` blocks in replies are drawn as diagrams in your theme's colours, with **Show source** to see the
  code. A block that doesn't parse stays as code, with the error above it. Mermaid loads the first time a reply has
  a diagram.

## Details pane

The details pane beside a chat shows:

- **Changed files** (collapsed until you open it): click one to open it in [review](review.md). Files in a git repo
  nested inside the session's folder are diffed in their own repo.
- The worktrees linked to the session, and its PRs.
- Plan usage and context, background shells, monitors and agents (with their output and a stop button).
- Sections added by [plugins](../plugins/writing.md#chat-details).

## Workflow pane

A workflow, or the chat's background agents, opens in a side pane with each phase and its agents. Click an agent
for its task, result and latest output. **Open conversation** shows the agent's whole conversation (prompt, replies,
tool calls and their output) the way the chat shows its own, and refreshes while the agent runs.

## Background chats

A chat whose tab you close keeps running until it has been idle for `argus.chat.backgroundIdleMinutes` (default
60), so other agents can message it and its timers keep firing. A reply that finishes after its tab closed shows in
**Needs you**.

## Finding Claude Code

`argus.chat.claudePath` sets the `claude` executable. Empty: `claude` on your PATH, then `~/.local/bin`, where
Claude Code's installer puts it. On startup and every 4 hours Argus compares `claude --version` with the newest
release on your `autoUpdatesChannel` and, once per release, says when it's out of date; **Update** (or **Argus:
Install or Update Claude Code**) runs `claude update` in a terminal.
