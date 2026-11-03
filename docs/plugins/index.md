---
title: Plugins
nav_order: 7
has_children: true
---

# Plugins

A plugin adds a tab to the Control Center, chips to session cards, extra steps when a session is archived, sections
in a chat's details pane, or a script inside Argus chats. Plugins are folders in `~/.claude/argus/plugins` that
Argus loads on startup; nothing is installed into VS Code.

## Installing one

Put the plugin's folder in the plugins folder and build it. For a plugin in a git repo:

macOS and Linux:

```bash
mkdir -p ~/.claude/argus/plugins && cd ~/.claude/argus/plugins
git clone <plugin repo url> my-plugin
cd my-plugin && npm install && npm run build
```

Windows (PowerShell):

```powershell
New-Item -ItemType Directory -Force "$HOME\.claude\argus\plugins" | Out-Null
Set-Location "$HOME\.claude\argus\plugins"
git clone <plugin repo url> my-plugin
Set-Location my-plugin; npm install; npm run build
```

Then run **Argus: Reload Plugins**. Argus asks once per folder before loading a plugin for the first time,
because a plugin runs with the same access to your machine that Argus has.

To update a plugin, run `git pull`, `npm install` and `npm run build` in its folder, then **Argus: Reload
Plugins**.

## Configuring one

Plugin settings live under one key, keyed by plugin id, and work at user or workspace level:

```json
"argus.plugins.config": {
  "my-plugin": { "someSetting": "value" }
}
```

A plugin's manifest sets its defaults and its README should list its keys. `argus.plugins.paths` loads extra plugin folders from anywhere on disk,
which is how you run one straight from a checkout.

To write your own, see [Writing a plugin](writing.md) and the [API reference](api.md).
