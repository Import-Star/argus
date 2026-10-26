import * as vscode from "vscode";

export const MULTI_AGENT_SETTING = "argus.chat.experimentalMultiAgent";

export function multiAgentEnabled(): boolean {
  return vscode.workspace.getConfiguration().get<boolean>(MULTI_AGENT_SETTING, false);
}
