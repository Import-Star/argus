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
  // Offers Authenticate: the server needs it, or it's a remote (http/sse) server that failed. A remote server whose
  // stored OAuth token the provider rejects (a refresh that comes back access_denied, say) reports "failed", not
  // "needs-auth", and Reconnect only retries that token, so signing in again is the way out.
  canAuthenticate: boolean;
  tools: McpTool[];
}

export interface McpPanelData {
  // False until the chat has started, when the SDK can't be asked yet.
  started: boolean;
  servers: McpServer[];
  // The outcome of the last Reconnect, Enable or Disable, shown on that server's row.
  result?: { server: string; action: string; error?: string };
}

const ORDER: Record<McpStatus, number> = { failed: 0, "needs-auth": 1, pending: 2, connected: 3, disabled: 4 };

export const isMcpIssue = (status: McpStatus): boolean => status === "failed" || status === "needs-auth";

export const countMcpIssues = (servers: readonly { status: McpStatus }[]): number => servers.filter((server) => isMcpIssue(server.status)).length;

// Servers Claude Code dials over http/sse itself, which can sign in with OAuth through /mcp. claude.ai connectors
// (claudeai-proxy) sign in on claude.ai instead, and stdio and sdk servers have no OAuth.
const isRemote = (config: McpServerStatus["config"]): boolean => config?.type === "http" || config?.type === "sse";

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
