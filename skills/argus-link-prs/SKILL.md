---
name: argus-link-prs
description: Use when the user asks you to add, link or attach pull requests to this session in Argus (the control centre / agent view), or says PRs this session opened aren't showing on its card.
---

# Argus: link PRs to this session

Argus finds PRs a session opens by watching for a `gh pr create` command. If a script or another tool opened the
PRs instead, they don't show on the session's card. Link them by hand with the session tracker.

## Command

    {{SCRIPT}} set --pr <url> [--pr <url>...] [--session <id>]

- `--pr` (repeatable) — a full GitHub pull request URL, e.g. `https://github.com/org/repo/pull/123`.
- `--session <id>` — this session's id. Omit it and Argus uses the one session working right now; if more than
  one is working it lists them, so rerun with the right id.
- Only pass PRs this session opened. Take the URLs from this session's own output, don't guess them.

## Example

    {{SCRIPT}} set --pr https://github.com/org/repo/pull/123 --pr https://github.com/org/repo/pull/124
