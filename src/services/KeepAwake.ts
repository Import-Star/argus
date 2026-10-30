import { ChildProcess, spawn } from "child_process";
import * as vscode from "vscode";
import { agentsBusy, inhibitorCommand, InhibitorCommand } from "./keepAwakeCommand";
import { output } from "./log";
import { SessionStore } from "./SessionStore";

// How long the lock outlives the last busy session, so a quick pause between turns doesn't drop and retake it.
const RELEASE_AFTER_MS = 2 * 60_000;

// argus.keepAwake.whileAgentsRun: stop the machine sleeping while any session in this window is working.
export class KeepAwake implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 999);
  private readonly disposables: vscode.Disposable[] = [];
  private child?: ChildProcess;
  private current?: InhibitorCommand;
  private releaseTimer?: NodeJS.Timeout;
  private failedWarned = false;

  public constructor(private readonly store: SessionStore) {
    this.item.command = "argus.openSettings";
    this.disposables.push(
      store.onDidChange(() => this.update()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("argus.keepAwake")) {
          this.stop();
          this.update();
        }
      })
    );
    this.update();
  }

  private config() {
    const config = vscode.workspace.getConfiguration("argus.keepAwake");
    return { enabled: config.get<boolean>("whileAgentsRun", false), keepScreenOn: config.get<boolean>("keepScreenOn", true) };
  }

  private update(): void {
    const { enabled } = this.config();
    const busy = enabled && agentsBusy(this.store.getCards().map((card) => card.column));
    if (busy) {
      if (this.releaseTimer) {
        clearTimeout(this.releaseTimer);
        this.releaseTimer = undefined;
      }
      this.start();
    } else if (!enabled) {
      this.stop();
    } else if (this.child && !this.releaseTimer) {
      this.releaseTimer = setTimeout(() => {
        this.releaseTimer = undefined;
        this.stop();
      }, RELEASE_AFTER_MS);
    }
    this.render();
  }

  private start(): void {
    if (this.child) {
      return;
    }
    const command = inhibitorCommand(process.platform, process.pid, this.config().keepScreenOn);
    if (!command) {
      this.warnOnce(`Argus can't keep this machine awake: ${process.platform} isn't supported.`);
      return;
    }
    let child: ChildProcess;
    try {
      child = spawn(command.command, command.args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    } catch (error) {
      this.warnOnce(`Argus couldn't start ${command.command} to keep this machine awake: ${String(error)}`);
      return;
    }
    this.child = child;
    this.current = command;
    output.appendLine(`[keepAwake] holding sleep off with ${command.label} (pid ${child.pid ?? "?"})`);
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    child.on("error", (error) => {
      this.warnOnce(`Argus couldn't run ${command.command} to keep this machine awake: ${error.message}`);
    });
    child.on("exit", (code, signal) => {
      if (this.child !== child) {
        return;
      }
      this.child = undefined;
      this.current = undefined;
      if (signal === null && code !== 0) {
        this.warnOnce(`Argus's keep-awake (${command.label}) stopped with code ${code}. ${stderr.trim()}`.trim());
      }
      this.render();
    });
  }

  private stop(): void {
    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = undefined;
    }
    const child = this.child;
    this.child = undefined;
    this.current = undefined;
    if (child && child.exitCode === null) {
      child.kill();
      output.appendLine("[keepAwake] released");
    }
    this.render();
  }

  private warnOnce(message: string): void {
    output.appendLine(`[keepAwake] ${message}`);
    if (!this.failedWarned) {
      this.failedWarned = true;
      void vscode.window.showWarningMessage(message);
    }
  }

  private render(): void {
    if (!this.child || !this.current) {
      this.item.hide();
      return;
    }
    this.item.text = "$(coffee) Awake";
    this.item.tooltip = this.releaseTimer
      ? `Argus is keeping this machine awake for a couple more minutes after the last agent finished (${this.current.label}). Closing the lid still sleeps it.`
      : `Argus is keeping this machine awake while agents run (${this.current.label}). Closing the lid still sleeps it.`;
    this.item.show();
  }

  public dispose(): void {
    this.stop();
    this.item.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}
