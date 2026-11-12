import type { McpServerStatus } from "@anthropic-ai/claude-agent-sdk";

export type McpStatus = McpServerStatus["status"];

export interface McpTool {
  name: string;
  description?: string;
  readOnly?: boolean;
  destructive?: boolean;
}

export interface McpServer {
  name: string;
  status: McpStatus;
  scope?: string;
  version?: string;
  error?: string;
  // Offers Authenticate: the server needs it, or it's a remote server that failed. A remote server whose stored OAuth
  // token the provider rejects (a refresh that comes back access_denied, say) reports "failed", not "needs-auth", and
  // Reconnect only retries that token, so signing in again is the way out.
  canAuthenticate: boolean;
  tools: McpTool[];
}

export interface McpPanelData {
  // False until the chat has started, when the SDK can't be asked yet.
  started: boolean;
  servers: McpServer[];
  // The outcome of the last Reconnect, Enable, Disable or Authenticate, shown on that server's row.
  result?: { server: string; action: string; error?: string };
  // A sign-in started from the panel that is waiting on the browser.
  signIn?: McpSignIn;
}

export interface McpSignIn {
  server: string;
  // True when Claude Code waits for the browser to come back to its localhost callback and then reconnects the server
  // itself. False for a claude.ai connector, which signs in on claude.ai and needs Reconnect afterwards.
  callbackExpected: boolean;
}

// The reply to the SDK's mcp_authenticate control request. Query.mcpAuthenticate isn't in the SDK's published types,
// but the CLI answers it and the official Claude Code extension uses it for its own MCP sign-in.
export interface McpAuthenticateResponse {
  authUrl?: string;
  requiresUserAction?: boolean;
  callbackExpected?: boolean;
  error?: string;
}

// The pasted address of the browser page a sign-in ended on, checked before it goes to Claude Code. The browser lands
// there after signing in; it fails to load when the localhost callback can't be reached (a remote window, say).
export function callbackUrlProblem(text: string): string | undefined {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return "Paste the whole address of the page the browser ended on.";
  }
  return url.searchParams.has("code") || url.searchParams.has("error") ? undefined : "That address has no sign-in code in it.";
}

const ORDER: Record<McpStatus, number> = { failed: 0, "needs-auth": 1, pending: 2, connected: 3, disabled: 4 };

export const isMcpIssue = (status: McpStatus): boolean => status === "failed" || status === "needs-auth";

export const countMcpIssues = (servers: readonly { status: McpStatus }[]): number => servers.filter((server) => isMcpIssue(server.status)).length;

// Servers that sign in through mcp_authenticate: http/sse servers with OAuth, and claude.ai connectors, which get a
// claude.ai sign-in page. stdio and sdk servers have no OAuth.
const isRemote = (config: McpServerStatus["config"]): boolean => config?.type === "http" || config?.type === "sse" || config?.type === "claudeai-proxy";

// Problems first, then by name.
export function toMcpServers(statuses: readonly McpServerStatus[]): McpServer[] {
  return statuses
    .map((status) => ({
      name: status.name,
      status: status.status,
      scope: status.scope ?? status.source,
      version: status.serverInfo?.version,
      error: status.error,
      canAuthenticate: status.status === "needs-auth" || (status.status === "failed" && isRemote(status.config)),
      tools: (status.tools ?? []).map((tool) => ({ name: tool.name, description: tool.description, readOnly: tool.annotations?.readOnly, destructive: tool.annotations?.destructive }))
    }))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name));
}
