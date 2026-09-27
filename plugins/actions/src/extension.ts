import * as vscode from "vscode";
import type { ArgusApi } from "../../../api";
import { ActionsService } from "./services/ActionsService";
import { ActionsTab } from "./providers/ActionsTab";
import { ApprovalsStatusBar } from "./providers/ApprovalsStatusBar";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const core = await vscode.extensions.getExtension<ArgusApi>("importstar.argus")?.activate();
  if (!core || core.version < 1) {
    return;
  }

  const actions = new ActionsService();
  const statusBar = new ApprovalsStatusBar(actions);
  const tab = new ActionsTab(context.extensionUri, actions);
  const handle = core.registerTab(tab);
  tab.setHandle(handle);

  context.subscriptions.push(actions, statusBar, tab, handle);

  const register = (command: string, callback: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(command, callback));

  register("argus.actions.open", () => core.openControlCentre("actions"));
  register("argus.actions.refresh", () => actions.refresh());
}
