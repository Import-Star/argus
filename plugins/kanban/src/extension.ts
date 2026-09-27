import * as vscode from "vscode";
import type { ArgusApi } from "../../../api";
import { KanbanController } from "./kanbanController";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const extension = vscode.extensions.getExtension<ArgusApi>("importstar.argus");
  const api = await extension?.activate();
  if (!api || api.version < 1) {
    return;
  }

  const controller = new KanbanController(context, api);
  context.subscriptions.push(controller);
  controller.activate();

  context.subscriptions.push(
    vscode.commands.registerCommand("argus.kanban.open", () => api.openControlCentre("kanban")),
    vscode.commands.registerCommand("argus.kanban.refreshPrs", () => controller.forceRefreshPrs())
  );
}

export function deactivate(): void {
  // Nothing to do: context.subscriptions handles disposal.
}
