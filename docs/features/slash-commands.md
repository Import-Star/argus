---
title: Slash commands
parent: Features
nav_order: 4
---

# Slash commands

Type `/` in a chat to list the session's commands, with their argument hints and descriptions. Commands go to
Claude Code as usual, except the ones Claude Code only has in its terminal screen, which Argus runs itself:

- `/remote-control` (`/rc`) continues the chat from claude.ai/code or the Claude app. The header shows
  **Remote Control** while it's on. Claude Code's `remoteControlAtStartup` setting turns it on for every chat.
- `/chrome` lets Claude control your browser through Claude in Chrome, and `/chrome browser` picks which browser.
  The header shows **Chrome** while it's on. Each chat remembers its own choice. New chats follow Claude Code's
  `/chrome` **Enabled by default**.
- `/add-dir` gives Claude another folder.
- `/permissions` opens a panel to see, add and remove allow, ask and deny rules and folders across your settings files; `/hooks` lists the hooks set in them; `/memory` opens the `CLAUDE.md` file you pick, creating it if missing.
- `/agents` opens a subagent file or makes a new one.
- `/resume` opens another session from the board.
- `/export [file]` saves the conversation as Markdown, `/copy [N]` copies Claude's latest (or Nth-latest) reply,
  `/branch` (`/fork`) copies the chat into a new one, and `/plan` turns on plan mode, or opens the plan pane if it's on.
- `/context`, `/usage` and `/skills` open a side panel: a context window breakdown by category (also opened by
  clicking the Context meter in the details panel), plan limit bars with session cost and what is contributing, and the loaded
  skills ranked by context cost.
- `/mcp` opens a side panel of MCP servers: status, errors and tools, with Enable/Disable, Reconnect and
  Authenticate. The header shows **MCP: N issues** when a server failed or needs authentication.
  - Authenticate shows on a server that needs authentication and on a remote server (http, sse or a claude.ai
    connector) that failed. When the provider rejects the stored OAuth token, the server reports failed rather than
    needs authentication, and Reconnect only retries that token, so sign in again.
  - Authenticate opens the server's sign-in page in your browser. The row waits for you and updates by itself once
    the server reconnects; **Open sign-in page again** reopens the page and **Stop waiting** clears the row. A claude.ai
    connector signs in on claude.ai, so press Reconnect afterwards.
  - If the browser page doesn't load after signing in (Claude Code's localhost callback can't be reached, e.g. in a
    remote window), paste that page's address into the row to finish signing in.
  - A Claude Code CLI too old for this opens `claude /mcp` in a terminal instead.
- `/model`, `/effort`, `/output-style`, `/advisor`, `/autocompact` and `/color` open a picker, and `/config` a
  searchable settings panel; typed with an argument they go to Claude Code as usual. `/color` tints the chat
  header. Plain-text command output is shown in a monospace block.
- `/loops` lists the loops saved in the folder and the ones in this chat, and deletes them. `/daemon` shows the
  Claude background service with Stop, Logs and Open config.
- `/login`, `/logout` and `/plugin` open `claude` in a terminal.

`/chrome` and `/add-dir` restart the chat's Claude process: they wait for the turn to end, and ask first while
background tasks are running.
