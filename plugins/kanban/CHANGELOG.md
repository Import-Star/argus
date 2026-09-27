# Changelog

## 0.1.0

- Work tab: kanban board of columns and cards, backed by a workspace JSON file that is never created
  implicitly (an empty state offers to create it).
- GitHub PR state on cards through the Argus core's `prs` API (`gh` under the hood), refreshed on a timer while
  the tab is visible and on demand.
- Linked Claude Code sessions shown as chips on their card; a 🎫 chip on the session for its linked card.
- Archive cleanup offers to remove board cards linked to, or sharing a pull request with, an archived session.
