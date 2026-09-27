#!/usr/bin/env bash
# Builds Argus from source and installs it into your VS Code. Run from any terminal.
set -euo pipefail
cd "$(dirname "$0")"

# The session tracker hook is TypeScript that Node runs natively, which needs Node 24+.
if ! command -v node >/dev/null 2>&1; then
  echo "node was not found on PATH. Install Node 24 or newer."
  exit 1
fi
node_major="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$node_major" -lt 24 ]]; then
  echo "Node $(node --version) found; Argus needs Node 24 or newer."
  exit 1
fi

code_cmd=""
use_open_fallback="false"
if command -v code >/dev/null 2>&1; then
  code_cmd="$(command -v code)"
elif [[ -x "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" ]]; then
  code_cmd="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
elif command -v open >/dev/null 2>&1; then
  use_open_fallback="true"
else
  echo "The 'code' CLI is not available. In VS Code, run: Shell Command: Install 'code' command in PATH"
  exit 1
fi

npm install
npm run compile
npm run package:vsix

name="$(node -p "require('./package.json').name")"
version="$(node -p "require('./package.json').version")"
vsix_file="${name}-${version}.vsix"

if [[ ! -f "$vsix_file" ]]; then
  echo "Expected VSIX not found: $vsix_file"
  exit 1
fi

# ELECTRON_RUN_AS_NODE is set inside VS Code terminals and breaks the CLI wrapper.
unset ELECTRON_RUN_AS_NODE

if [[ "$use_open_fallback" == "true" ]]; then
  open -a "Visual Studio Code" --args --install-extension "$vsix_file" --force
else
  "$code_cmd" --install-extension "$vsix_file" --force
fi

echo "Installed $vsix_file locally."
echo "Next: run 'Developer: Reload Window' in VS Code, then 'Argus: Install Session Tracker Hooks' (re-run it after hook changes)."
