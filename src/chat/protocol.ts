import type { EffortLevel, PermissionMode, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export type { EffortLevel, PermissionMode, SDKMessage };

// Starts every review-comments prompt, so the transcript can show it as one short line.
export const REVIEW_PROMPT_START = "Review comments on your changes.";

export type ChatStatus = "starting" | "idle" | "working" | "needs-you" | "ended" | "error";

export interface ModelOption {
  value: string;
  displayName: string;
  efforts: EffortLevel[];
}

export interface ChatMeta {
  sessionId: string;
  cwd: string;
  title?: string;
  branch?: string;
  status: ChatStatus;
  statusSince: number;
  model?: string;
  effort?: EffortLevel;
  permissionMode: PermissionMode;
  models: ModelOption[];
  contextTokens?: number;
  contextMax?: number;
  lastResponseAt?: number;
  cacheTtlMs?: number;
  error?: string;
}

// Board data for one session: what the details pane and the rail show beside the transcript.
export interface CardInfo {
  sessionId: string;
  worktree?: string;
  prs: { key: string; title?: string; url: string; state: string; isDraft: boolean; reviewDecision?: string; checks: { name: string; status: string; conclusion?: string }[] }[];
  usedTokens?: number;
  compactions?: number;
}

export interface RailSession {
  sessionId: string;
  title: string;
  column: string;
  activity?: string;
  since: number;
  repo: string;
}

export interface ChatGroupMember {
  sessionId: string;
  title: string;
  status: ChatStatus;
}

// Agents that share one board card. The id is the first session's id.
export interface ChatGroup {
  id: string;
  title: string;
  members: ChatGroupMember[];
}

export interface PermissionRequest {
  id: string;
  toolName: string;
  toolUseId?: string;
  input: Record<string, unknown>;
  decisionReason?: string;
  blockedPath?: string;
  // What "always allow" would remember, e.g. "Bash(yarn workspace:*)". Unset when the SDK offers nothing to remember.
  alwaysLabel?: string;
  createdAt: number;
}

export type PermissionDecision =
  | { behavior: "allow"; always?: boolean; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message: string };

export type ChangeScope = "base" | "turn" | "uncommitted" | "session" | "pr";

export interface FileChange {
  path: string;
  added: number;
  removed: number;
  status: string;
}

export interface DiffLine {
  kind: "add" | "del" | "ctx" | "gap";
  oldNo?: number;
  newNo?: number;
  text: string;
}

export interface FileDiff {
  path: string;
  lines: DiffLine[];
}

export interface DiffComment {
  id: string;
  path: string;
  line: number;
  side?: "old" | "new";
  code?: string;
  text: string;
}

export type HostMessage =
  | { type: "layout"; view: "single" | "grid"; sessionIds: string[]; groupId?: string }
  | { type: "groups"; groups: ChatGroup[] }
  | { type: "meta"; meta: ChatMeta }
  | { type: "card"; card: CardInfo }
  | { type: "rail"; sessions: RailSession[] }
  | { type: "history"; sessionId: string; messages: SDKMessage[] }
  | { type: "sdk"; sessionId: string; message: SDKMessage }
  | { type: "permission"; sessionId: string; request: PermissionRequest }
  | { type: "permissionResolved"; sessionId: string; id: string }
  | { type: "fileSuggestions"; sessionId: string; query: string; files: string[] }
  | { type: "changes"; sessionId: string; scope: ChangeScope; prUrl?: string; base?: string; files: FileChange[]; error?: string }
  | { type: "fileDiff"; sessionId: string; scope: ChangeScope; prUrl?: string; diff: FileDiff }
  | { type: "taskOutput"; sessionId: string; taskId: string; output: string }
  | { type: "openReview"; sessionId: string; scope: ChangeScope };

export type WebviewMessage =
  | { type: "archive"; sessionId: string }
  | { type: "ready" }
  | { type: "send"; sessionId: string; text: string; images?: { mediaType: string; data: string }[] }
  | { type: "interrupt"; sessionId: string }
  | { type: "setModel"; sessionId: string; model: string }
  | { type: "setEffort"; sessionId: string; effort: EffortLevel }
  | { type: "setPermissionMode"; sessionId: string; mode: PermissionMode }
  | { type: "permission"; sessionId: string; id: string; decision: PermissionDecision }
  | { type: "fileSuggestions"; sessionId: string; query: string }
  | { type: "openFile"; sessionId: string; path: string; line?: number }
  | { type: "openUrl"; url: string }
  | { type: "openSession"; sessionId: string }
  | { type: "newChat" }
  | { type: "addAgent"; sessionId: string }
  | { type: "openGroup"; sessionId: string }
  | { type: "grid"; action: "add" | "remove" | "expand"; sessionId: string }
  | { type: "changes"; sessionId: string; scope: ChangeScope; files?: string[]; prUrl?: string }
  | { type: "fileDiff"; sessionId: string; scope: ChangeScope; path: string; files?: string[]; prUrl?: string }
  | { type: "sendComments"; sessionId: string; comments: DiffComment[] }
  | { type: "taskOutput"; sessionId: string; taskId: string }
  | { type: "stopTask"; sessionId: string; taskId: string };
