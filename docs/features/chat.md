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
- In a typed answer or note to a question, and in **Or tell Claude what to do instead** on a permission request,
  Shift+Enter adds a new line and Enter sends.
- A plan waiting for approval offers **Approve, accept edits**, **Approve, ask before edits** or **Keep planning**.
  The plan pane shows the plan as Markdown. Select text to comment; the text stays highlighted and the comment shows under
  that line. **Keep planning** sends the saved comments back with the plan.
- The chat's details pane lists the latest plan under **Plan**, so you can reopen it after the approval request is
  gone (for example after a window reload).
- A chat's name is sent to Claude Code with `/rename`, so `/resume` and other sessions show the same title.

## Working in a chat

- **Rewind to here** restores files and the conversation to a message. **Fork from here** starts a new chat from it.
- Cmd/Ctrl+F searches the transcript, folded tool output included.
- **Ask aside** (Cmd/Ctrl+;) asks a side question without adding it to the transcript.
- Queued messages can be edited, reordered or sent now.
- Each reply shows its turn's cost, and code blocks and replies have copy buttons.
- Type `/` for the session's slash commands (see [Slash commands](slash-commands.md)), and paste or drop files to
  attach them.
- Type `#` to pick another session on the board. It's added as `#"<name>"`. For a running session that's the name
  Claude's `SendMessage` and `ListAgents` tools use, so you can tell one agent to message or check on another. A
  stopped session can't be messaged and is added by its title.
- **Text only** hides tool calls and shows just the conversation. `argus.chat.textOnlyDefault` opens every chat
  that way; each chat remembers its own toggle.
- ` ```mermaid ` blocks in replies are drawn as diagrams in your theme's colours, with **Show source** to see the
  code. A block that doesn't parse stays as code, with the error above it. Mermaid loads the first time a reply has
  a diagram.
- Claude can show a small interactive widget (a slider, calculator, form or chart) as a card in the chat with its
  `show_html` tool, without asking first. The widget runs in a sandboxed frame: it can't read the chat page, call
  VS Code, or make network requests (`fetch`, XHR and WebSockets are blocked). Scripts must be inline or load from
  `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `unpkg.com` or `cdn.tailwindcss.com`, and inline `onclick=`
  attributes don't run. A button in the widget can call `argus.send(text)` to put text in the message box; you
  still press send. The widget uses your theme's `--vscode-*` colours and font, grows up to 600px tall and scrolls
  past that. **Show source** shows its HTML.

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

Argus chat runs in one background process per user, not inside each window. Argus starts it when a chat opens, and
it runs on VS Code's own Node, so there's nothing to install. Closing or reloading a window doesn't stop its chats:
a reply that's still running finishes, and reopening the chat (or the restored tab after a reload) shows it. The
same chat open in two windows shares one Claude process, and either window can answer its permission prompts.
Archiving a chat stops it at once in every window. A chat that no window has open stops after it has been idle for
`argus.chat.backgroundIdleMinutes`.

Windows talk to the process over a local socket only: `~/.claude/argus/chat.sock` on macOS and Linux, a named pipe on
Windows. Each connection must send a random token from `~/.claude/argus/chat-daemon.json`, which only your user can
read. The process exits about 10 seconds after its last chat stops and no window is connected. After an Argus
update, the old process keeps its chats running until they are all idle, then exits. Windows reconnect to the new
one and resume their chats. If the update changed how windows talk to the process, a window can't use the old one,
so Argus chat waits and shows a warning with **Restart Now**. Clicking it ends the old process from the window at
once, whichever version it is, together with its chats' Claude processes and everything they started, such as a
background command that never finishes. Whenever the process exits while a chat is still working or has background
tasks, it stops that chat's Claude process and everything below it too, so nothing is left running. Its log is `~/.claude/argus/chat-daemon.log`.

## Start a chat from a link

Opening `vscode://importstar.argus-control-center/new-agent?prompt=<text>&cwd=<folder>` starts a new chat with that
first message, in `cwd` or the window's first folder. VS Code asks before it opens each link. Don't tick "Don't ask
again": any web page could then start a chat with its own prompt.

## Finding Claude Code

`argus.chat.claudePath` sets the `claude` executable. Empty: `claude` on your PATH, then `~/.local/bin`, where
Claude Code's installer puts it. On startup and every 4 hours Argus compares `claude --version` with the newest
release on your `autoUpdatesChannel` and, once per release, says when it's out of date; **Update** (or **Argus:
Install or Update Claude Code**) runs `claude update` in a terminal.
