import type * as vscode from "vscode";
import type { SessionCard } from "../types";
import type { LiveChat } from "../services/sessionColumn";
import type { ChatPluginSection } from "../services/chatDetails";
import type { PermissionDecision, PermissionRequest } from "./protocol";

export interface ChatDeps {
  getCards(): SessionCard[];
  onDidChangeCards: vscode.Event<unknown>;
  markRead(sessionId: string): void;
  getGroupOf(): Record<string, string>;
  addToGroup(newSessionId: string, existingSessionId: string): void;
  removeFromGroup(sessionId: string): void;
  setLiveChats(provider: (() => LiveChat[]) | undefined): void;
  archive(sessionId: string): Promise<void>;
  rename(sessionId: string): Promise<void>;
  // Plugin sections for the Details pane (ArgusApi.registerChatDetails).
  pluginSections(card: SessionCard): ChatPluginSection[];
  pluginAction(sessionId: string, key: string, itemId: string, value?: string): Promise<void>;
  onDidChangePluginSections(listener: () => void): { dispose(): void };
}

// What the core sees of the chat bundle (out/chat/host.js).
export interface ChatHost extends vscode.Disposable {
  open(sessionId?: string, prompt?: string, column?: vscode.ViewColumn): Promise<void>;
  openGrid(sessionIds?: string[], groupId?: string): void;
  addToGrid(sessionId: string): void;
  review(sessionId: string, target: { worktree?: string; prUrl?: string }): Promise<void>;
  isChatSession(sessionId: string): boolean;
  isViewing(sessionId: string): boolean;
  pendingFor(sessionId: string): PermissionRequest[];
  respond(sessionId: string, id: string, decision: PermissionDecision): void;
  send(sessionId: string, text: string): void;
  closeSession(sessionId: string): boolean;
  onDidChangePending: vscode.Event<void>;
}

export type ActivateChat = (context: vscode.ExtensionContext, deps: ChatDeps) => ChatHost;
