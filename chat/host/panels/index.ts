import * as vscode from "vscode";
import type { Panel, PanelData, PanelKind } from "../../../src/chat/panels";
import type { ChatSession } from "../ChatSession";
import { mcpPanel } from "./mcp";
import { permissionsPanel } from "./permissions";
import { hooksPanel } from "./hooks";
import { contextPanel } from "./context";
import { usagePanel } from "./usage";
import { configPanel } from "./config";
import { skillsPanel } from "./skills";
import { loopsPanel } from "./loops";
import { daemonPanel } from "./daemon";
import type { PanelHandler } from "./types";

const HANDLERS: { [K in PanelKind]: PanelHandler<PanelData[K]> } = {
  mcp: mcpPanel,
  permissions: permissionsPanel,
  hooks: hooksPanel,
  context: contextPanel,
  usage: usagePanel,
  config: configPanel,
  skills: skillsPanel,
  loops: loopsPanel,
  daemon: daemonPanel,
};

export async function openPanel(session: ChatSession, kind: PanelKind): Promise<void> {
  session.showPanel({ kind, data: await HANDLERS[kind].load(session) } as Panel);
}

export async function panelAction(session: ChatSession, kind: PanelKind, action: string, payload: unknown): Promise<void> {
  try {
    if (action !== "refresh") {
      await HANDLERS[kind].action?.(session, action, payload);
    }
  } catch (error) {
    void vscode.window.showErrorMessage(`Argus: /${kind} ${action} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  await openPanel(session, kind);
}
