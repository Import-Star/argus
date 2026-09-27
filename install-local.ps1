# Builds Argus from source and installs it into your VS Code. Run from any terminal.
$ErrorActionPreference = 'Stop'

function Invoke-Checked {
  param([string]$Command, [string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "'$Command $($Arguments -join ' ')' failed with exit code $LASTEXITCODE" }
}

# The session tracker hook is TypeScript that Node runs natively, which needs Node 24+.
$nodeVersion = (node --version 2>$null)
if (-not $nodeVersion) { throw "node was not found on PATH. Install Node 24 or newer." }
if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 24) { throw "Node $nodeVersion found; Argus needs Node 24 or newer." }

# Resolve code.cmd explicitly: plain `code` can match Code.exe (the GUI binary), which opens a window and hangs.
$codeCmd = (Get-Command code.cmd -ErrorAction SilentlyContinue).Source
if (-not $codeCmd) {
  $codeCmd = @(
    "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd",
    "$env:ProgramFiles\Microsoft VS Code\bin\code.cmd"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $codeCmd) { throw "The 'code' CLI is not available. In VS Code, run: Shell Command: Install 'code' command in PATH" }

Push-Location $PSScriptRoot
try {
  Invoke-Checked npm.cmd @('install')
  Invoke-Checked npm.cmd @('run', 'compile')
  Invoke-Checked npm.cmd @('run', 'package:vsix')

  $name = node -p "require('./package.json').name"
  $version = node -p "require('./package.json').version"
  $vsixFile = "$name-$version.vsix"
  if (-not (Test-Path $vsixFile)) { throw "Expected VSIX not found: $vsixFile" }

  # ELECTRON_RUN_AS_NODE is set inside VS Code terminals and breaks the CLI wrapper.
  $env:ELECTRON_RUN_AS_NODE = $null

  Invoke-Checked $codeCmd @('--install-extension', $vsixFile, '--force')

  Write-Host "Installed $vsixFile locally."
  Write-Host "Next: run 'Developer: Reload Window' in VS Code, then 'Argus: Install Session Tracker Hooks' (re-run it after hook changes)."
} finally {
  Pop-Location
}
