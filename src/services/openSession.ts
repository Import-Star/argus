import * as vscode from "vscode";
import { SessionCard } from "../types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ChatRoute = (sessionId: string | undefined, prompt: string | undefined, column?: vscode.ViewColumn) => Promise<void>;
let chatRoute: ChatRoute | undefined;

// Set once Argus chat has loaded: every session opens there.
export function routeChatsTo(route: ChatRoute | undefined): void {
  chatRoute = route;
}

let chatClose: ((sessionId: string) => boolean) | undefined;

export function routeCloseTo(close: ((sessionId: string) => boolean) | undefined): void {
  chatClose = close;
}

// True when the session's Argus chat was open and is now closed.
export function closeChatSession(sessionId: string): boolean {
  return chatClose?.(sessionId) ?? false;
}

export async function openClaudeTab(sessionId: string | undefined, prompt: string | undefined, column?: vscode.ViewColumn): Promise<void> {
  if (!chatRoute) {
    void vscode.window.showErrorMessage("Argus: chat hasn't started. Reload the window, or check the Argus output for why.");
    return;
  }
  await chatRoute(sessionId, prompt, column);
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
    void vscode.window.showErrorMessage(`Argus: could not open the session: ${message}`);
  }
}
