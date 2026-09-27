# Argus Kanban

Adds the **Work** tab to the Argus Control Centre: a kanban board for tickets, with GitHub PR state and links to
the Claude Code sessions working on each card.

Requires Argus (`importstar.argus`) to be installed and activated.

## What it does

- A board of columns and cards, stored as JSON in your workspace. Drag cards between columns, add/rename/remove
  columns and cards, and edit card text in place.
- The board file is never created automatically. With no board file present, the Work tab shows an empty state
  with a **Create board** button; with no workspace folder open, it shows a message asking you to open one.
- Paste a GitHub pull request URL into a card's text and Argus Kanban shows its state (open/merged/closed, draft,
  checks, review decision, reviewers) as chips on the card. PR state uses `gh` through Argus (via the core
  extension's `prs` API) - Argus Kanban never calls `gh` directly.
- PR state refreshes automatically every `argus.sessions.prRefreshMinutes` minutes while the Work tab is visible,
  once when you switch to it, and on demand with the ↻ button or the **Argus: Refresh Work Board PR Status**
  command.
- A card with a running or finished Claude Code session shows a chip for that session instead of the "▶ agent"
  button; clicking it opens the session. "▶ agent" starts a new Claude Code session prefilled with the card's text
  and links it back to the card.
- The Sessions tab shows a 🎫 chip on any session linked to a Work card, and offers to remove the matching board
  card when you archive a session with cleanup (a card is offered when it's linked to the session, or it mentions
  one of the same pull request URLs).

## Setting

- `argus.kanban.boardFile` (default `active-work.json`): workspace-relative path to the board's JSON file,
  resolved against the first workspace folder.

## Commands

- **Argus: Open Work Board** (`argus.kanban.open`) - opens the Control Centre on the Work tab.
- **Argus: Refresh Work Board PR Status** (`argus.kanban.refreshPrs`) - forces an immediate PR state refresh.
