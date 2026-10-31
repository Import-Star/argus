import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";
import { findClaude, installerShell, isOlder, parseVersion, releaseUrl, updaterShell } from "./claudeCli";

export const INSTALL_CLAUDE_COMMAND = "argus.chat.installClaude";
const NOTIFIED_KEY = "argus.claude.missingNotified";
const UPDATE_NOTIFIED_KEY = "argus.claude.updateNotified";
const POLL_MS = 2000;
const POLL_LIMIT_MS = 15 * 60_000;
const UPDATE_CHECK_MS = 4 * 60 * 60_000;

export function configuredClaude(): string | undefined {
  return findClaude(vscode.workspace.getConfiguration("argus.chat").get<string>("claudePath", ""));
}

// Shown when a chat can't start, and once per Argus version at startup. Stateless, so the chat bundle can call it too.
export async function promptMissingClaude(): Promise<void> {
  const install = "Install Claude Code";
  const setPath = "Set Path…";
  const choice = await vscode.window.showWarningMessage("Argus: Claude Code isn't installed, so Argus chat can't start.", install, setPath);
  if (choice === install) {
    await vscode.commands.executeCommand(INSTALL_CLAUDE_COMMAND, true);
  } else if (choice === setPath) {
    await vscode.commands.executeCommand("workbench.action.openSettings", "argus.chat.claudePath");
  }
}

export function registerClaudeSetup(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand(INSTALL_CLAUDE_COMMAND, (confirmed?: unknown) => installClaude(confirmed === true)));
  // Windows stay open for days, so checking only at startup would miss most releases.
  const checkForUpdate = (): void => {
    const claude = configuredClaude();
    if (claude) {
      void notifyOutdated(context, claude);
    }
  };
  const timer = setInterval(checkForUpdate, UPDATE_CHECK_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  if (configuredClaude()) {
    checkForUpdate();
    return;
  }
  const key = String(context.extension.packageJSON.version);
  if (context.globalState.get<string>(NOTIFIED_KEY) !== key) {
    void context.globalState.update(NOTIFIED_KEY, key);
    void promptMissingClaude();
  }
}

// Undefined when the version check fails, e.g. offline.
async function claudeVersions(claude: string): Promise<{ current: string; latest: string } | undefined> {
  try {
    const { stdout } = await promisify(execFile)(claude, ["--version"], { timeout: 10_000 });
    const current = parseVersion(stdout);
    const response = await fetch(releaseUrl(readUpdateChannel()), { signal: AbortSignal.timeout(10_000) });
    const body = (await response.text()).trim();
    // An error page or proxy banner must not pass as a release.
    const latest = response.ok && /^\d+\.\d+\.\d+$/.test(body) ? body : undefined;
    return current && latest ? { current, latest } : undefined;
  } catch {
    return undefined;
  }
}

function readUpdateChannel(): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude", "settings.json"), "utf8")).autoUpdatesChannel;
  } catch {
    return undefined;
  }
}

// Once per new Claude Code release, so dismissing it doesn't bring it back every window.
async function notifyOutdated(context: vscode.ExtensionContext, claude: string): Promise<void> {
  const versions = await claudeVersions(claude);
  if (!versions || !isOlder(versions.current, versions.latest) || context.globalState.get<string>(UPDATE_NOTIFIED_KEY) === versions.latest) {
    return;
  }
  void context.globalState.update(UPDATE_NOTIFIED_KEY, versions.latest);
  const update = "Update";
  const choice = await vscode.window.showWarningMessage(`Argus: Claude Code ${versions.current} is out of date (latest ${versions.latest}).`, update);
  if (choice === update) {
    await vscode.commands.executeCommand(INSTALL_CLAUDE_COMMAND, true);
  }
}

// Runs `claude update` in a terminal; still runs it when the version check fails so the user sees why.
async function updateClaude(claude: string): Promise<void> {
  const versions = await claudeVersions(claude);
  if (versions && !isOlder(versions.current, versions.latest)) {
    void vscode.window.showInformationMessage(`Argus: Claude Code ${versions.current} is up to date.`);
    return;
  }
  vscode.window.createTerminal({ name: "Update Claude Code", ...updaterShell(claude) }).show();
}

// Updates an existing install, or runs Anthropic's installer where the user can watch it, then offers to sign in
// once `claude` appears.
async function installClaude(confirmed: boolean): Promise<void> {
  const existing = configuredClaude();
  if (existing) {
    return updateClaude(existing);
  }
  const { shellPath, shellArgs, command } = installerShell();
  if (!confirmed) {
    const choice = await vscode.window.showInformationMessage(
      "Install Claude Code?",
      { modal: true, detail: `Argus runs Anthropic's official installer in a terminal:\n\n${command}` },
      "Install"
    );
    if (!choice) {
      return;
    }
  }
  const terminal = vscode.window.createTerminal({ name: "Install Claude Code", shellPath, shellArgs });
  terminal.show();

  const found = await new Promise<string | undefined>((resolve) => {
    const started = Date.now();
    const closed = vscode.window.onDidCloseTerminal((closedTerminal) => {
      if (closedTerminal === terminal) {
        finish(configuredClaude());
      }
    });
    const timer = setInterval(() => {
      const claude = configuredClaude();
      if (claude || Date.now() - started > POLL_LIMIT_MS) {
        finish(claude);
      }
    }, POLL_MS);
    function finish(claude: string | undefined): void {
      clearInterval(timer);
      closed.dispose();
      resolve(claude);
    }
  });

  if (!found) {
    void vscode.window.showWarningMessage("Argus: couldn't find Claude Code after the installer ran. Check the terminal for errors, or set argus.chat.claudePath.");
    return;
  }
  // Claude Code signs in on its first interactive run, through the browser.
  const signIn = "Sign In";
  const choice = await vscode.window.showInformationMessage("Argus: Claude Code is installed. Sign in once so Argus chat can use it.", signIn);
  if (choice === signIn) {
    vscode.window.createTerminal({ name: "Claude Code sign-in", shellPath: found }).show();
  }
}
