import { StringDecoder } from "string_decoder";
import type { SessionCronSummary } from "@anthropic-ai/claude-agent-sdk";
import type { PanelKind } from "./panels";
import type { ChatMeta, EffortLevel, HostMessage, PermissionMode, PermissionRequest, QueuedMessage, ShellRun } from "./protocol";

// Bump when a frame's shape changes; a client and daemon with different numbers can't talk.
export const DAEMON_PROTOCOL = 2;

export interface OpenOptions {
  sessionId: string;
  cwd: string;
  resume: boolean;
  title?: string;
  claudePath?: string;
  additionalDirectories: string[];
  model?: string;
  effort?: EffortLevel;
  permissionMode: PermissionMode;
  textOnly: boolean;
  chrome?: boolean;
  color?: string;
  remoteControlAtStartup?: boolean;
  hiddenModels: string[];
  // A session no window has open stops once it has been idle this long.
  idleMinutes: number;
  // The opening window's environment, so the claude process sees the same PATH etc. as it did in-process.
  env: Record<string, string | undefined>;
}

// Claude's new_agent tool: start another chat, in this chat's grid or in its own tab.
export interface NewAgentRequest {
  prompt: string;
  inThisChat: boolean;
  cwd: string;
}

// Everything a window reads from a session synchronously; sent whenever it changes.
export interface SessionState {
  meta: ChatMeta;
  processStartedAt: number;
  sessionCrons?: SessionCronSummary[];
  claudePath?: string;
  additionalDirectories: string[];
  runningBackgroundTasks: number;
  stoppable: boolean;
  pendingRequests: PermissionRequest[];
  queued: QueuedMessage[];
  lastTurnFiles: string[];
  shellRuns: ShellRun[];
  hasQuery: boolean;
}

// Session methods a window may call; the daemon refuses anything else.
export const SESSION_METHODS = [
  "start",
  "setRemoteControl",
  "chromeBrowsers",
  "selectChromeBrowser",
  "setChrome",
  "addDirectory",
  "history",
  "send",
  "queueAction",
  "interrupt",
  "setModel",
  "setEffort",
  "saveEffortDefault",
  "setColor",
  "clearEffort",
  "initInfo",
  "settings",
  "setPermissionMode",
  "stopTask",
  "rewindFiles",
  "relaunch",
  "truncateTo",
  "respond",
  "rename",
  "syncName",
  "setMcpServers"
] as const;
export type SessionMethod = (typeof SESSION_METHODS)[number];

// Error text for a Query method this CLI's SDK doesn't have.
export const QUERY_UNSUPPORTED = "not supported";

export type ClientRequest =
  // Keep this shape in every protocol version: it is how mismatched builds find each other.
  // builtAt is daemon.js's mtime: a daemon hands over only to a newer build, so mixed windows don't take turns.
  // script is the client's daemon.js, which an older daemon starts as it exits.
  | { op: "hello"; token: string; protocol: number; build: string; builtAt: number; script: string }
  // Attaches this window to the session, creating it when the daemon doesn't have it. Result: SessionState.
  | { op: "open"; options: OpenOptions }
  // This window no longer shows the session; the daemon's idle rule decides when it stops.
  | { op: "detach"; sessionId: string }
  // Stop now (archive): ends the claude process whatever other windows show it.
  | { op: "stop"; sessionId: string }
  | { op: "call"; sessionId: string; method: SessionMethod; args: unknown[] }
  // Calls a method on the session's SDK Query object.
  | { op: "query"; sessionId: string; method: string; args: unknown[] }
  | { op: "shell"; sessionId: string; method: "run" | "act"; args: unknown[] }
  // Result: string[] of live session ids.
  | { op: "list" };

export type ClientFrame = { id: number } & ClientRequest;

export interface HelloResult {
  protocol: number;
  build: string;
  builtAt: number;
  sessions: string[];
}

export type DaemonFrame =
  | { id: number; ok: true; result?: unknown }
  | { id: number; ok: false; error: string }
  | { event: "message"; sessionId: string; message: HostMessage; state?: SessionState }
  | { event: "refreshPanel"; sessionId: string; kind: PanelKind }
  | { event: "closed"; sessionId: string }
  // Sent to one window only, so two windows showing the chat don't both start the agent.
  | { event: "newAgent"; sessionId: string; request: NewAgentRequest }
  | { event: "log"; line: string };

// Frames are one JSON object per line.
export function frameReader(onFrame: (frame: unknown) => void): (chunk: Buffer | string) => void {
  let buffer = "";
  const decoder = new StringDecoder("utf8");
  return (chunk) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim()) {
        onFrame(JSON.parse(line));
      }
    }
  };
}

export const encodeFrame = (frame: ClientFrame | DaemonFrame): string => `${JSON.stringify(frame)}\n`;
