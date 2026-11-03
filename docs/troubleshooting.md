---
title: Troubleshooting
nav_order: 9
---

# Troubleshooting

- **No sessions appear**: run **Argus: Set Up Session Tracking**, check that `node --version` is 24 or newer in a
  terminal, then start a new Claude Code session.
- **Argus says session tracking needs updating**: click **Set Up Session Tracking** in the warning. Argus updates
  the hook script on its own after an upgrade, but a new hook event or a Node that moved needs `settings.json`
  changed, so it asks first.
- **Sessions stop updating after a Claude Code update**: Argus depends on Claude Code's session registry file,
  which is not a stable public API. If it changes shape, session detection can break until Argus is updated.
- **Chat says Claude Code isn't installed**: click **Install Claude Code**, or run **Argus: Install or Update Claude Code**.
  If `claude --version` already works in a terminal, set `argus.chat.claudePath` to its path.
- **PR status fails**: run `gh auth status`. If `gh` is installed but not found, make sure it is on the PATH VS
  Code was launched with.

Argus logs to the **Argus** output channel, plugins to **Argus Plugins**. To report a bug, open an
[issue on GitHub](https://github.com/Import-Star/argus/issues).
