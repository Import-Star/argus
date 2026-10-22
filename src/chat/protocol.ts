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

export interface SlashItem {
  name: string;
  description: string;
  argumentHint: string;
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
  commands?: SlashItem[];
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
  worktrees: { name: string; path: string; branch?: string }[];
  prs: { key: string; title?: string; url: string; state: string; isDraft: boolean; reviewDecision?: string; checks: { name: string; status: string; conclusion?: string }[] }[];
  usedTokens?: number;
  compactions?: number;
}

// claude.ai plan limits as /usage reports them. Null where plan limits don't apply (API key, Bedrock, Vertex).
export interface PlanUsageWindow {
  key: string;
  label: string;
  percent: number;
  resetsAt?: number;
}

export interface PlanUsage {
  windows: PlanUsageWindow[];
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

// A message sent while Claude is working. `sent` means the CLI already took it, so it can no longer be withdrawn.
export interface QueuedMessage {
  id: string;
  text: string;
  images: number;
  sent: boolean;
}

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
  lines?: { oldNo: number; newNo: number; text: string }[];
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
  | { type: "changes"; sessionId: string; scope: ChangeScope; prUrl?: string; worktree?: string; base?: string; files: FileChange[]; error?: string }
  | { type: "fileDiff"; sessionId: string; scope: ChangeScope; prUrl?: string; worktree?: string; diff: FileDiff }
  | { type: "taskOutput"; sessionId: string; taskId: string; output: string }
  | { type: "queue"; sessionId: string; items: QueuedMessage[] }
  | { type: "usage"; sessionId: string; usage: PlanUsage | null }
  | { type: "openReview"; sessionId: string; scope: ChangeScope }
  | { type: "rewound"; sessionId: string; userMessageId: string; text: string }
  | { type: "draft"; sessionId: string; text: string }
  | { type: "aside"; sessionId: string; askId: string; text: string; status: "streaming" | "done" | "error"; error?: string };

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
  | { type: "openFile"; sessionId: string; path: string; line?: number; worktree?: string }
  | { type: "openUrl"; url: string }
  | { type: "openSimpleBrowser"; url: string }
  | { type: "openSession"; sessionId: string }
  | { type: "newChat" }
  | { type: "addAgent"; sessionId: string }
  | { type: "openGroup"; sessionId: string }
  | { type: "grid"; action: "add" | "remove" | "expand"; sessionId: string }
  | { type: "changes"; sessionId: string; scope: ChangeScope; files?: string[]; prUrl?: string; worktree?: string }
  | { type: "fileDiff"; sessionId: string; scope: ChangeScope; path: string; files?: string[]; prUrl?: string; worktree?: string }
  | { type: "sendComments"; sessionId: string; comments: DiffComment[] }
  | { type: "taskOutput"; sessionId: string; taskId: string }
  | { type: "usage"; sessionId: string }
  | { type: "stopTask"; sessionId: string; taskId: string }
  | { type: "queue"; sessionId: string; id: string; action: "edit" | "remove" | "up" | "down" | "sendNow"; text?: string }
  | { type: "rewind"; sessionId: string; userMessageId: string; text: string }
  | { type: "fork"; sessionId: string; messageId: string; before?: boolean; draft?: string }
  | { type: "aside"; sessionId: string; askId: string; text: string }
  | { type: "asideClose"; sessionId: string };
