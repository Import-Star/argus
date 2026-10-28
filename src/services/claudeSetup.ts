import * as vscode from "vscode";
import { findClaude, installerShell } from "./claudeCli";

export const INSTALL_CLAUDE_COMMAND = "argus.chat.installClaude";
const NOTIFIED_KEY = "argus.claude.missingNotified";
const POLL_MS = 2000;
const POLL_LIMIT_MS = 15 * 60_000;

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
  if (configuredClaude()) {
    return;
  }
  const key = String(context.extension.packageJSON.version);
  if (context.globalState.get<string>(NOTIFIED_KEY) !== key) {
    void context.globalState.update(NOTIFIED_KEY, key);
    void promptMissingClaude();
  }
}

// Runs Anthropic's installer where the user can watch it, then offers to sign in once `claude` appears.
async function installClaude(confirmed: boolean): Promise<void> {
  const existing = configuredClaude();
  if (existing) {
    void vscode.window.showInformationMessage(`Argus: Claude Code is already installed at ${existing}.`);
    return;
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
