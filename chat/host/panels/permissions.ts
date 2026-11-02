import * as os from "os";
import * as vscode from "vscode";
import { settingsFiles } from "../../../src/chat/localCommands";
import { RULE_LISTS, addRule, collectRules, removeRule, type PermissionsPanelData, type RuleList } from "../../../src/chat/panels/permissions";
import { parseSettings, readRaw, readSettingsFiles, writeSettings } from "../../../src/chat/settingsJson";
import type { PanelHandler } from "./types";

interface Payload {
  list: RuleList;
  text: string;
  file: string;
}

export const permissionsPanel: PanelHandler<PermissionsPanelData> = {
  load: async (session) => {
    const files = readSettingsFiles(settingsFiles(session.meta.cwd, os.homedir()));
    return {
      rules: collectRules(files),
      files: files.map(({ label, description, file, error }) => ({ label, description, file, error, exists: readRaw(file) !== undefined })),
      sessionFolders: session.additionalDirectories
    };
  },
  action: async (session, action, payload) => {
    const { list, text, file } = payload as Payload;
    if (action === "open") {
      await vscode.window.showTextDocument(vscode.Uri.file(file));
      return;
    }
    if (!settingsFiles(session.meta.cwd, os.homedir()).some((choice) => choice.file === file) || !RULE_LISTS.includes(list)) {
      throw new Error("Unknown settings file or list");
    }
    const { json, error } = parseSettings(readRaw(file));
    if (error) {
      throw new Error(`${file} is not valid JSON (${error}), so it was not changed`);
    }
    const next = action === "add" ? addRule(json, list, text) : removeRule(json, list, text);
    if (next !== json) {
      writeSettings(file, next);
    }
  }
};
