import * as vscode from "vscode";
import { SessionCard } from "../types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Args: sessionId, initialPrompt, viewColumn, group, fullEditor, options.
// A programmatic value other than "honor-preferred-location" always opens an editor tab, never the sidebar.
async function openClaudeTab(sessionId: string | undefined, prompt: string | undefined, column?: vscode.ViewColumn): Promise<void> {
  const target = column ?? vscode.window.tabGroups.activeTabGroup.viewColumn;
  try {
    await vscode.commands.executeCommand("claude-vscode.editor.open", sessionId, prompt, target, undefined, undefined, {
      programmatic: "argus"
    });
  } catch (error) {
    const installed = vscode.extensions.getExtension("anthropic.claude-code");
    void vscode.window.showErrorMessage(
      installed
        ? `Argus: could not open a Claude Code tab: ${error instanceof Error ? error.message : String(error)}`
        : "Argus: the Claude Code extension (anthropic.claude-code) is required to open sessions."
    );
  }
}

export async function newChat(column?: vscode.ViewColumn): Promise<void> {
  await openClaudeTab(undefined, undefined, column);
}

// Used by ArgusApi.sessions.start; the caller (core or a plugin) has already appended any link marker.
export async function startChat(prompt: string, column?: vscode.ViewColumn): Promise<void> {
  await openClaudeTab(undefined, prompt, column);
}

export async function openWorktree(folder: string): Promise<void> {
  await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(folder), { forceNewWindow: true });
}

export async function openSession(card: SessionCard, column?: vscode.ViewColumn): Promise<void> {
  const { sessionId } = card.record;
  if (!UUID.test(sessionId)) {
    void vscode.window.showWarningMessage(`Argus: ${sessionId} is not a Claude Code session id.`);
    return;
  }
  try {
    await openClaudeTab(sessionId, undefined, column);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Could not open Claude Code session: ${message}`);
  }
}
