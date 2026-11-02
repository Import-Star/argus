import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { parseDaemonStatus, summariseDaemonConfig } from "../../../src/chat/daemon";
import type { DaemonPanelData } from "../../../src/chat/panels/daemon";
import type { ChatSession } from "../ChatSession";
import type { PanelHandler } from "./types";

const configFile = path.join(os.homedir(), ".claude", "daemon.json");
const claude = (session: ChatSession) => session.claudePath ?? "claude";

function run(session: ChatSession, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(claude(session), ["daemon", ...args], { cwd: session.meta.cwd, timeout: 15000 }, (error, stdout, stderr) => {
      const output = (stdout || stderr).trim();
      // Status exits non-zero when the daemon is down but still prints why.
      return output ? resolve(output) : error ? reject(error) : resolve("");
    });
  });
}

export const daemonPanel: PanelHandler<DaemonPanelData> = {
  load: async (session) => {
    const raw = await run(session, ["status"]).catch((error: Error) => error.message);
    const hasConfig = fs.existsSync(configFile);
    return {
      status: parseDaemonStatus(raw),
      raw,
      config: hasConfig ? summariseDaemonConfig(fs.readFileSync(configFile, "utf8")) : [],
      configFile: hasConfig ? configFile : undefined
    };
  },
  action: async (session, action) => {
    if (action === "stop") {
      const choice = await vscode.window.showWarningMessage("Stop the Claude background service? This also ends every background session it runs.", { modal: true }, "Stop");
      if (choice === "Stop") {
        await run(session, ["stop"]);
      }
    } else if (action === "logs") {
      vscode.window.createTerminal({ name: "Claude daemon logs", cwd: session.meta.cwd, shellPath: claude(session), shellArgs: ["daemon", "logs"] }).show();
    } else if (action === "open-config" && fs.existsSync(configFile)) {
      await vscode.window.showTextDocument(vscode.Uri.file(configFile));
    }
  }
};
