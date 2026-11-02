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
  tools: McpTool[];
}

export interface McpPanelData {
  // False until the chat has started, when the SDK can't be asked yet.
  started: boolean;
  servers: McpServer[];
}

const ORDER: Record<McpStatus, number> = { failed: 0, "needs-auth": 1, pending: 2, connected: 3, disabled: 4 };

export const isMcpIssue = (status: McpStatus): boolean => status === "failed" || status === "needs-auth";

export const countMcpIssues = (servers: readonly { status: McpStatus }[]): number => servers.filter((server) => isMcpIssue(server.status)).length;

// Problems first, then by name.
export function toMcpServers(statuses: readonly McpServerStatus[]): McpServer[] {
  return statuses
    .map((status) => ({
      name: status.name,
      status: status.status,
      scope: status.scope ?? status.source,
      version: status.serverInfo?.version,
      error: status.error,
      tools: (status.tools ?? []).map((tool) => ({ name: tool.name, description: tool.description, readOnly: tool.annotations?.readOnly, destructive: tool.annotations?.destructive }))
    }))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name));
}
