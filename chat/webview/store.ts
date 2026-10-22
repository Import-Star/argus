import { useCallback, useEffect, useState } from "preact/hooks";
import type { CardInfo, ChangeScope, ChatGroup, ChatMeta, FileChange, FileDiff, HostMessage, PermissionRequest, PlanUsage, QueuedMessage, RailSession,SDKMessage, WebviewMessage } from "../../src/chat/protocol";

import { noteArrival } from "./backgroundTasks";
import { EMPTY_REVIEW, type ReviewState } from "./review";
import { rewindMessages } from "./rewind";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; setState(state: unknown): void };
const vscodeApi = acquireVsCodeApi();

export function post(message: WebviewMessage): void {
  vscodeApi.postMessage(message);
}

export type SidePane = "details" | "plan" | "review" | "workflow" | "preview";

export interface SessionUi {
  side: SidePane;
  reviewScope: ChangeScope;
  reviewFile?: string;
  prUrl?: string;
  worktree?: string;
  workflowTaskId?: string;
  agentTaskId?: string;
  textOnly?: boolean;
  draft?: string;
  previewUrl?: string;
}

export interface SessionState {
  meta?: ChatMeta;
  card?: CardInfo;
  messages: SDKMessage[];
  permissions: PermissionRequest[];
  fileSuggestions?: { query: string; files: string[] };
  changes?: { scope: ChangeScope; prUrl?: string; worktree?: string; base?: string; files: FileChange[]; error?: string };
  diffs: Record<string, FileDiff>;
  taskOutputs: Record<string, string>;
  queue: QueuedMessage[];
  usage?: PlanUsage | null;
  review: ReviewState;
  ui: SessionUi;
}

export interface State {
  view: "single" | "grid";
  sessionIds: string[];
  groupId?: string;
  groups: ChatGroup[];
  rail: RailSession[];
  sessions: Record<string, SessionState>;
}

let state: State = { view: "single", sessionIds: [], groups: [], rail: [], sessions: {} };
const listeners = new Set<() => void>();

function emptySession(): SessionState {
  return { messages: [], permissions: [], diffs: {}, taskOutputs: {}, queue: [], review: EMPTY_REVIEW, ui: { side: "details", reviewScope: "base" } };
}

function set(next: State): void {
  state = next;
  listeners.forEach((listener) => listener());
}

export function getState(): State {
  return state;
}

export function updateSession(sessionId: string, update: (session: SessionState) => SessionState): void {
  set({ ...state, sessions: { ...state.sessions, [sessionId]: update(state.sessions[sessionId] ?? emptySession()) } });
}

export function setUi(sessionId: string, patch: Partial<SessionUi>): void {
  updateSession(sessionId, (session) => ({ ...session, ui: { ...session.ui, ...patch } }));
}

export function updateReview(sessionId: string, update: (review: ReviewState) => ReviewState): void {
  updateSession(sessionId, (session) => ({ ...session, review: update(session.review) }));
}

export function dispatch(message: HostMessage): void {
  switch (message.type) {
    case "layout":
      vscodeApi.setState({ view: message.view, sessionIds: message.sessionIds, groupId: message.groupId });
      set({ ...state, view: message.view, sessionIds: message.sessionIds, groupId: message.groupId });
      return;
    case "groups":
      set({ ...state, groups: message.groups });
      return;
    case "rail":
      set({ ...state, rail: message.sessions });
      return;
    case "meta":
      updateSession(message.meta.sessionId, (session) => ({ ...session, meta: message.meta }));
      return;
    case "card":
      updateSession(message.card.sessionId, (session) => ({ ...session, card: message.card }));
      return;
    case "history":
      updateSession(message.sessionId, (session) => ({ ...session, messages: message.messages }));
      return;
    case "sdk":
      noteArrival(message.message);
      updateSession(message.sessionId, (session) => ({ ...session, messages: [...session.messages, message.message] }));
      return;
    case "permission":
      updateSession(message.sessionId, (session) => ({
        ...session,
        permissions: [...session.permissions.filter((request) => request.id !== message.request.id), message.request]
      }));
      return;
    case "permissionResolved":
      updateSession(message.sessionId, (session) => ({ ...session, permissions: session.permissions.filter((request) => request.id !== message.id) }));
      return;
    case "fileSuggestions":
      updateSession(message.sessionId, (session) => ({ ...session, fileSuggestions: { query: message.query, files: message.files } }));
      return;
    case "changes":
      updateSession(message.sessionId, (session) => ({
        ...session,
        changes: { scope: message.scope, prUrl: message.prUrl, worktree: message.worktree, base: message.base, files: message.files, error: message.error }
      }));
      return;
    case "fileDiff":
      updateSession(message.sessionId, (session) => ({ ...session, diffs: { ...session.diffs, [message.diff.path]: message.diff } }));
      return;
    case "rewound":
      updateSession(message.sessionId, (session) => ({ ...session, messages: rewindMessages(session.messages, message.userMessageId), ui: { ...session.ui, draft: message.text } }));
      return;
    case "draft":
      setUi(message.sessionId, { draft: message.text });
      return;
    case "openReview":
      setUi(message.sessionId, { side: "review", reviewScope: message.scope, worktree: undefined, reviewFile: undefined });
      return;
    case "usage":
      updateSession(message.sessionId, (session) => ({ ...session, usage: message.usage }));
      return;
    case "queue":
      updateSession(message.sessionId, (session) => ({ ...session, queue: message.items }));
      return;
    case "taskOutput":
      updateSession(message.sessionId, (session) => ({ ...session, taskOutputs: { ...session.taskOutputs, [message.taskId]: message.output } }));
      return;
  }
}

// Pass a stable select (module-level or useCallback): a new function each render re-subscribes every render.
export function useStore<T>(select: (state: State) => T): T {
  const [value, setValue] = useState(() => select(state));
  useEffect(() => {
    const listener = () => setValue(() => select(state));
    listeners.add(listener);
    listener();
    return () => void listeners.delete(listener);
  }, [select]);
  return value;
}

const EMPTY = emptySession();

export function useSession(sessionId: string): SessionState {
  return useStore(useCallback((current: State) => current.sessions[sessionId] ?? EMPTY, [sessionId]));
}
