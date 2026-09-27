---
name: argus-rename-session
description: Use when Argus asks you to title this Claude Code session (a note in context mentions the argus-rename-session skill and a session id), when the task in this session changes substantially, or right after you create or move into a git worktree.
---

# Argus: rename session

Argus (a VS Code extension) tracks this session in its Sessions view by title. Keep that title current by
running the session tracker in "set" mode — no other script is needed.

## Command

    {{SCRIPT}} set --title "<title>" [--worktree <path>] [--session <id>]

- `--title` — a short title, under 60 characters, specific to the current task, no surrounding quotes, no
  emoji. Example: `Fix VAT rounding in invoice totals`.
- `--session <id>` — take it from the Argus note in this conversation's context (it reads "Session id: ...").
  Omit the flag if you don't know it; Argus falls back to the most recently active session in this directory.
- `--worktree <path>` (repeatable) — pass this whenever you create or switch into a git worktree, so Argus
  links it to this session. The path can be relative to your current directory.
- Run it once, near the start of the session, once the task is clear enough to title well. Run it again only
  if the task changes substantially — don't re-title for every small step.

## Examples

Set the title (works the same in Bash and PowerShell):

    {{SCRIPT}} set --title "Fix VAT rounding in invoice totals" --session <id>

Link a worktree you just created, without changing the title:

    {{SCRIPT}} set --worktree "../myrepo-feature-x" --session <id>
