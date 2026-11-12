import { useEffect, useState } from "preact/hooks";
import type { McpPanelData, McpServer, McpStatus } from "../../../../src/chat/panels/mcp";
import { panelAction } from "./CommandPanel";
import "./mcp.css";

const ACTIONS: Record<string, { verb: string; busy: string; done: string }> = {
  reconnect: { verb: "Reconnect", busy: "Reconnecting…", done: "Reconnected" },
  enable: { verb: "Enable", busy: "Enabling…", done: "Enabled" },
  disable: { verb: "Disable", busy: "Disabling…", done: "Disabled" }
};

const LABELS: Record<McpStatus, string> = { connected: "Connected", failed: "Failed", "needs-auth": "Needs authentication", pending: "Connecting", disabled: "Disabled" };

function Server({ sessionId, server, result }: { sessionId: string; server: McpServer; result?: McpPanelData["result"] }) {
  const [busy, setBusy] = useState<string>();
  // Every reload sends new server objects, so a reply to the action clears the busy state.
  useEffect(() => setBusy(undefined), [server]);
  const act = (action: string) => {
    setBusy(ACTIONS[action].busy);
    panelAction(sessionId, "mcp", action, server.name);
  };
  const disabled = server.status === "disabled";
  const outcome = result?.server === server.name ? result : undefined;
  return (
    <li class="mcp-row">
      <div class="mcp-line">
        <span class={`mcp-dot mcp-dot-${server.status}`} aria-hidden="true" />
        <span class="mcp-name">{server.name}</span>
        <span class="mcp-meta">
          {[LABELS[server.status], server.scope, server.version && `v${server.version}`].filter(Boolean).join(" · ")}
        </span>
        {busy && <span class="mcp-busy">{busy}</span>}
        {!busy && outcome && !outcome.error && <span class="mcp-done">{ACTIONS[outcome.action].done}</span>}
        <span class="mcp-actions">
          {server.canAuthenticate && (
            <button type="button" class="cmdp-btn" title="Opens claude /mcp in a terminal to sign in again" onClick={() => panelAction(sessionId, "mcp", "authenticate", server.name)}>
              Authenticate
            </button>
          )}
          {!disabled && server.status !== "needs-auth" && (
            <button type="button" class="cmdp-btn" disabled={Boolean(busy)} onClick={() => act("reconnect")}>
              Reconnect
            </button>
          )}
          <button type="button" class="cmdp-btn" disabled={Boolean(busy)} onClick={() => act(disabled ? "enable" : "disable")}>
            {disabled ? "Enable" : "Disable"}
          </button>
        </span>
      </div>
      {outcome?.error && !busy && <p class="mcp-error">{`${ACTIONS[outcome.action].verb} failed: ${outcome.error}`}</p>}
      {server.error && server.error !== outcome?.error && <p class="mcp-error">{server.error}</p>}
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
        <Server key={server.name} sessionId={sessionId} server={server} result={data.result} />
      ))}
    </ul>
  );
}
