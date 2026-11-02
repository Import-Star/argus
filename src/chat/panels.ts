import type { PanelKind } from "./localCommands";
import type { McpPanelData } from "./panels/mcp";
import type { PermissionsPanelData } from "./panels/permissions";
import type { HooksPanelData } from "./panels/hooks";
import type { ContextPanelData } from "./panels/context";
import type { UsagePanelData } from "./panels/usage";
import type { ConfigPanelData } from "./panels/config";
import type { SkillsPanelData } from "./panels/skills";
import type { LoopsPanelData } from "./panels/loops";
import type { DaemonPanelData } from "./panels/daemon";

export type { PanelKind };

export interface PanelData {
  mcp: McpPanelData;
  permissions: PermissionsPanelData;
  hooks: HooksPanelData;
  context: ContextPanelData;
  usage: UsagePanelData;
  config: ConfigPanelData;
  skills: SkillsPanelData;
  loops: LoopsPanelData;
  daemon: DaemonPanelData;
}

export type Panel = { [K in PanelKind]: { kind: K; data: PanelData[K] } }[PanelKind];
