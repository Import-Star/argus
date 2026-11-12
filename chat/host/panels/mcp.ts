import * as vscode from "vscode";
import { toMcpServers, type McpPanelData } from "../../../src/chat/panels/mcp";
import type { ChatSession } from "../ChatSession";
import type { PanelHandler } from "./types";

const results = new WeakMap<ChatSession, McpPanelData["result"]>();

export const mcpPanel: PanelHandler<McpPanelData> = {
  load: async (session) => {
    const statuses = await session.activeQuery?.mcpServerStatus();
    const servers = toMcpServers(statuses ?? []);
    session.setMcpServers(servers);
    const result = results.get(session);
    results.delete(session);
    return { started: Boolean(statuses), servers, result };
  },
  action: async (session, action, payload) => {
    const name = String(payload);
    if (action === "authenticate") {
      const statuses = await session.activeQuery?.mcpServerStatus().catch(() => undefined);
      return authenticate(session, statuses?.find((status) => status.name === name)?.status === "failed");
    }
    const q = session.activeQuery;
    try {
      if (action === "enable" || action === "disable") {
        await q?.toggleMcpServer(name, action === "enable");
      } else if (action === "reconnect") {
        await q?.reconnectMcpServer(name);
      }
      results.set(session, { server: name, action });
    } catch (error) {
      results.set(session, { server: name, action, error: error instanceof Error ? error.message : String(error) });
    }
  }
};

function authenticate(session: ChatSession, failed: boolean): void {
  const shell = vscode.window.createTerminal({ name: "Claude /mcp", cwd: session.meta.cwd, shellPath: session.claudePath ?? "claude", shellArgs: ["/mcp"] });
  shell.show();
  // A failed server stays failed until it reconnects with the new token.
  const next = failed ? "press Reconnect" : "press Refresh";
  void vscode.window.showInformationMessage(`Argus: pick the server in /mcp and authenticate, then ${next} in the MCP panel.`);
}
