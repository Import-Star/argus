import type { McpPanelData, McpServer, McpStatus } from "../../../../src/chat/panels/mcp";
import { panelAction } from "./CommandPanel";
import "./mcp.css";

const LABELS: Record<McpStatus, string> = { connected: "Connected", failed: "Failed", "needs-auth": "Needs authentication", pending: "Connecting", disabled: "Disabled" };

function Server({ sessionId, server }: { sessionId: string; server: McpServer }) {
  const act = (action: string) => panelAction(sessionId, "mcp", action, server.name);
  const disabled = server.status === "disabled";
  return (
    <li class="mcp-row">
      <div class="mcp-line">
        <span class={`mcp-dot mcp-dot-${server.status}`} aria-hidden="true" />
        <span class="mcp-name">{server.name}</span>
        <span class="mcp-meta">
          {[LABELS[server.status], server.scope, server.version && `v${server.version}`].filter(Boolean).join(" · ")}
        </span>
        <span class="mcp-actions">
          {server.status === "needs-auth" && (
            <button type="button" class="cmdp-btn" title="Opens claude /mcp in a terminal" onClick={() => act("authenticate")}>
              Authenticate
            </button>
          )}
          {!disabled && (
            <button type="button" class="cmdp-btn" onClick={() => act("reconnect")}>
              Reconnect
            </button>
          )}
          <button type="button" class="cmdp-btn" onClick={() => act(disabled ? "enable" : "disable")}>
            {disabled ? "Enable" : "Disable"}
          </button>
        </span>
      </div>
      {server.error && <p class="mcp-error">{server.error}</p>}
      {server.tools.length > 0 && (
        <details class="mcp-tools">
          <summary>
            {server.tools.length} {server.tools.length === 1 ? "tool" : "tools"}
          </summary>
          <ul>
            {server.tools.map((tool) => (
              <li key={tool.name}>
                <span class="mono">{tool.name}</span>
                {tool.readOnly && <span class="mcp-badge">read-only</span>}
                {tool.destructive && <span class="mcp-badge mcp-badge-destructive">destructive</span>}
                {tool.description && <div class="mcp-desc">{tool.description}</div>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

export function McpPanel({ sessionId, data }: { sessionId: string; data: McpPanelData }) {
  if (!data.started) {
    return <p class="cmdp-empty">Send a message to start the chat, then open /mcp again to see its servers.</p>;
  }
  if (data.servers.length === 0) {
    return <p class="cmdp-empty">No MCP servers are configured for this chat.</p>;
  }
  return (
    <ul class="mcp-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {data.servers.map((server) => (
        <Server key={server.name} sessionId={sessionId} server={server} />
      ))}
    </ul>
  );
}
