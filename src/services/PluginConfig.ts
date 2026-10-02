import * as vscode from "vscode";
import { PluginConfig } from "../types";

const SECTION = "argus.plugins";
const KEY = "config";

type PluginsSetting = Record<string, Record<string, unknown> | undefined>;

// Merges the scopes by hand rather than taking the whole argus.plugins.config object, so a workspace can set one
// key of a plugin without restating the user-level ones. Later scopes win per key.
function readSlice(pluginId: string): Record<string, unknown> {
  const inspected = vscode.workspace.getConfiguration(SECTION).inspect<PluginsSetting>(KEY);
  const merged: Record<string, unknown> = {};
  for (const scope of [inspected?.defaultValue, inspected?.globalValue, inspected?.workspaceValue, inspected?.workspaceFolderValue]) {
    Object.assign(merged, scope?.[pluginId]);
  }
  return merged;
}

export function createPluginConfig(pluginId: string, defaults: Record<string, unknown>, disposables: vscode.Disposable[]): PluginConfig {
  const emitter = new vscode.EventEmitter<readonly string[]>();
  let last = readSlice(pluginId);

  disposables.push(
    emitter,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(`${SECTION}.${KEY}`)) {
        return;
      }
      const next = readSlice(pluginId);
      const changed = [...new Set([...Object.keys(last), ...Object.keys(next)])].filter(
        (key) => JSON.stringify(last[key]) !== JSON.stringify(next[key])
      );
      last = next;
      if (changed.length > 0) {
        emitter.fire(changed);
      }
    })
  );

  return {
    get<T>(key: string, fallback?: T): T {
      const slice = readSlice(pluginId);
      const value = key in slice ? slice[key] : defaults[key];
      return (value === undefined ? fallback : value) as T;
    },
    async update(key: string, value: unknown, target = vscode.ConfigurationTarget.Global): Promise<void> {
      const config = vscode.workspace.getConfiguration(SECTION);
      const inspected = config.inspect<PluginsSetting>(KEY);
      const current =
        target === vscode.ConfigurationTarget.Workspace
          ? inspected?.workspaceValue
          : target === vscode.ConfigurationTarget.WorkspaceFolder
            ? inspected?.workspaceFolderValue
            : inspected?.globalValue;
      const slice = { ...current?.[pluginId] };
      if (value === undefined) {
        delete slice[key];
      } else {
        slice[key] = value;
      }
      await config.update(KEY, { ...current, [pluginId]: slice }, target);
    },
    onDidChange: emitter.event
  };
}
