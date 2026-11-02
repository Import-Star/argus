import type { Panel } from "../../../../src/chat/panels";
import { post, setUi, useSession } from "../../store";
import { McpPanel } from "./McpPanel";
import { PermissionsPanel } from "./PermissionsPanel";
import { HooksPanel } from "./HooksPanel";
import { ContextPanel } from "./ContextPanel";
import { UsagePanel } from "./UsagePanel";
import { ConfigPanel } from "./ConfigPanel";
import { SkillsPanel } from "./SkillsPanel";
import { LoopsPanel } from "./LoopsPanel";
import { DaemonPanel } from "./DaemonPanel";
import "./panels.css";

const TITLES: Record<Panel["kind"], string> = { mcp: "MCP servers", permissions: "Permissions", hooks: "Hooks", context: "Context", usage: "Usage", config: "Settings", skills: "Skills", loops: "Loops", daemon: "Background service" };

export function panelAction(sessionId: string, kind: Panel["kind"], action: string, payload?: unknown): void {
  post({ type: "panelAction", sessionId, kind, action, payload });
}

function Body({ sessionId, panel }: { sessionId: string; panel: Panel }) {
  switch (panel.kind) {
    case "mcp":
      return <McpPanel sessionId={sessionId} data={panel.data} />;
    case "permissions":
      return <PermissionsPanel sessionId={sessionId} data={panel.data} />;
    case "hooks":
      return <HooksPanel sessionId={sessionId} data={panel.data} />;
    case "context":
      return <ContextPanel sessionId={sessionId} data={panel.data} />;
    case "usage":
      return <UsagePanel sessionId={sessionId} data={panel.data} />;
    case "config":
      return <ConfigPanel sessionId={sessionId} data={panel.data} />;
    case "skills":
      return <SkillsPanel sessionId={sessionId} data={panel.data} />;
    case "loops":
      return <LoopsPanel sessionId={sessionId} data={panel.data} />;
    case "daemon":
      return <DaemonPanel sessionId={sessionId} data={panel.data} />;
  }
}

export function CommandPanel({ sessionId }: { sessionId: string }) {
  const { ui } = useSession(sessionId);
  const panel = ui.panel;
  if (!panel) {
    return null;
  }
  return (
    <section class="cmdp">
      <header class="cmdp-head">
        <h2>{TITLES[panel.kind]}</h2>
        <button type="button" class="cmdp-btn" onClick={() => panelAction(sessionId, panel.kind, "refresh")}>Refresh</button>
        <button type="button" class="cmdp-btn" onClick={() => setUi(sessionId, { side: "details", panel: undefined })}>Close</button>
      </header>
      <div class="cmdp-body">
        <Body sessionId={sessionId} panel={panel} />
      </div>
    </section>
  );
}
