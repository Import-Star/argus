import * as vscode from "vscode";
import { toMcpServers, type McpPanelData } from "../../../src/chat/panels/mcp";
import type { ChatSession } from "../ChatSession";
import type { PanelHandler } from "./types";

export const mcpPanel: PanelHandler<McpPanelData> = {
  load: async (session) => {
    const statuses = await session.activeQuery?.mcpServerStatus();
    const servers = toMcpServers(statuses ?? []);
    session.setMcpServers(servers);
    return { started: Boolean(statuses), servers };
  },
  action: async (session, action, payload) => {
    const name = String(payload);
    if (action === "authenticate") {
      return authenticate(session);
    }
    const q = session.activeQuery;
    if (action === "enable" || action === "disable") {
      await q?.toggleMcpServer(name, action === "enable");
    } else if (action === "reconnect") {
      await q?.reconnectMcpServer(name);
    }
  }
};

function authenticate(session: ChatSession): void {
  const shell = vscode.window.createTerminal({ name: "Claude /mcp", cwd: session.meta.cwd, shellPath: session.claudePath ?? "claude", shellArgs: ["/mcp"] });
  shell.show();
  void vscode.window.showInformationMessage("Argus: pick the server in /mcp and authenticate, then press Refresh in the MCP panel.");
}
