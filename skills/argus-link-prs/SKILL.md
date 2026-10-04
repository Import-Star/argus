---
name: argus-link-prs
description: Use right after you open a pull request any way other than running `gh pr create` yourself (a skill, script, `gh api`, an MCP tool, the GitHub web UI), so it shows on this session's Argus card. Also use when the user asks to add, link or attach PRs to this session in Argus, or says PRs aren't showing on its card.
---

# Argus: link PRs to this session

Argus finds PRs a session opens by watching for a `gh pr create` command. If a script or another tool opened the
PRs instead, they don't show on the session's card. Link them by hand with the session tracker.

## When to run it

Run it yourself, without being asked, as soon as you open a PR any other way — for example through a skill
(like create-pr), a script, `gh api`, an MCP tool, or a PR the user opened for this session's work.
If you ran `gh pr create` directly, skip it; Argus already has that PR.

## Command

    {{SCRIPT}} set --pr <url> [--pr <url>...] [--session <id>]

- `--pr` (repeatable) — a full GitHub pull request URL, e.g. `https://github.com/org/repo/pull/123`.
- `--session <id>` — this session's id. Omit it and Argus uses the one session working right now; if more than
  one is working it lists them, so rerun with the right id.
- Only pass PRs this session opened. Take the URLs from this session's own output, don't guess them.

## Example

    {{SCRIPT}} set --pr https://github.com/org/repo/pull/123 --pr https://github.com/org/repo/pull/124
