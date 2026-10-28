import * as vscode from "vscode";
import { ArgusTab, TabHandle } from "../types";
import { buildSettingGroups } from "../services/settingsSchema";

type FromWebview =
  | { type: "ready" }
  | { type: "set"; id: string; value: unknown }
  | { type: "reset"; id: string }
  | { type: "openJson" }
  | { type: "openSettings" };

export function createSettingsTab(context: vscode.ExtensionContext): { tab: ArgusTab; attach(handle: TabHandle): void; disposables: vscode.Disposable[] } {
  let handle: TabHandle | undefined;
  const configuration = context.extension.packageJSON?.contributes?.configuration;
  const ids = new Set<string>(
    (Array.isArray(configuration) ? configuration : [configuration]).flatMap((section) => Object.keys(section?.properties ?? {}))
  );

  const push = () => {
    const config = vscode.workspace.getConfiguration();
    handle?.post({ type: "settings", groups: buildSettingGroups(configuration, (id) => config.inspect(id)) });
  };

  const tab: ArgusTab = {
    id: "settings",
    title: "Settings",
    order: 1000,
    script: vscode.Uri.joinPath(context.extensionUri, "media", "settings.js"),
    style: vscode.Uri.joinPath(context.extensionUri, "media", "settings.css"),
    onMessage: async (message: unknown) => {
      const msg = message as FromWebview;
      switch (msg.type) {
        case "ready":
          push();
          return;
        case "set":
          if (ids.has(msg.id)) {
            await vscode.workspace.getConfiguration().update(msg.id, msg.value, vscode.ConfigurationTarget.Global);
          }
          return;
        case "reset":
          if (ids.has(msg.id)) {
            await vscode.workspace.getConfiguration().update(msg.id, undefined, vscode.ConfigurationTarget.Global);
          }
          return;
        case "openJson":
          await vscode.commands.executeCommand("workbench.action.openSettingsJson");
          return;
        case "openSettings":
          await vscode.commands.executeCommand("workbench.action.openSettings", `@ext:${context.extension.id}`);
          return;
        default:
          return;
      }
    }
  };

  return {
    tab,
    attach(h: TabHandle) {
      handle = h;
    },
    disposables: [
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("argus")) {
          push();
        }
      })
    ]
  };
}
