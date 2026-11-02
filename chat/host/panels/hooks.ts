import * as os from "os";
import * as vscode from "vscode";
import { settingsFiles } from "../../../src/chat/localCommands";
import { collectHooks, eventLine, type HooksPanelData } from "../../../src/chat/panels/hooks";
import { readRaw, readSettingsFiles } from "../../../src/chat/settingsJson";
import type { PanelHandler } from "./types";

export const hooksPanel: PanelHandler<HooksPanelData> = {
  load: async (session) => {
    const files = readSettingsFiles(settingsFiles(session.meta.cwd, os.homedir()));
    return {
      groups: collectHooks(files),
      files: files.map(({ label, file, error }) => ({ label, file, error, exists: readRaw(file) !== undefined }))
    };
  },
  action: async (session, action, payload) => {
    const { file, event } = payload as { file: string; event?: string };
    if (action !== "open" || !settingsFiles(session.meta.cwd, os.homedir()).some((choice) => choice.file === file)) {
      return;
    }
    const line = event ? eventLine(readRaw(file) ?? "", event) : 0;
    await vscode.window.showTextDocument(vscode.Uri.file(file), { selection: new vscode.Range(line, 0, line, 0) });
  }
};
