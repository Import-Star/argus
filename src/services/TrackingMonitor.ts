import * as vscode from "vscode";
import { checkTracking, TrackingProblem } from "./HookInstaller";
import { output } from "./log";

const REMOVED_KEY = "argus.tracking.removed";
const NOTIFIED_KEY = "argus.tracking.notified";

export const TRACKING_MESSAGE: Record<TrackingProblem, string> = {
  off: "Session tracking is off, so sessions won't show here.",
  partial: "Session tracking needs updating for this version of Argus.",
  "node-missing": "Session tracking can't find the Node it was set up with."
};

// Keeps the hook script current by itself, and says when session tracking needs the user to run Set Up.
export class TrackingMonitor implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  public readonly onDidChange = this.emitter.event;
  private current?: TrackingProblem;
  private readonly focus: vscode.Disposable;

  public constructor(private readonly context: vscode.ExtensionContext) {
    // Settings and Node installs change outside VS Code, so look again whenever the window comes back.
    this.focus = vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        this.check();
      }
    });
    this.check();
  }

  public get problem(): TrackingProblem | undefined {
    return this.current;
  }

  public get message(): string | undefined {
    return this.current ? TRACKING_MESSAGE[this.current] : undefined;
  }

  public check(): void {
    const { problem, scriptUpdated } = checkTracking(this.context.extensionPath);
    if (scriptUpdated) {
      output.appendLine(`${new Date().toISOString()} Updated the session tracking hook script to this version of Argus.`);
    }
    // Someone who removed tracking on purpose doesn't need telling it's off.
    const next = problem === "off" && this.context.globalState.get<boolean>(REMOVED_KEY) ? undefined : problem;
    if (next !== this.current) {
      this.current = next;
      this.emitter.fire();
    }
    this.notify();
  }

  // Set Up and Remove call this, so a deliberate removal stays quiet.
  public setRemoved(removed: boolean): void {
    void this.context.globalState.update(REMOVED_KEY, removed || undefined);
    this.check();
  }

  // "Off" shows on the board and the Welcome page; a setup that broke gets one popup per Argus version.
  private notify(): void {
    if (this.current !== "partial" && this.current !== "node-missing") {
      return;
    }
    const key = `${this.context.extension.packageJSON.version}:${this.current}`;
    if (this.context.globalState.get<string>(NOTIFIED_KEY) === key) {
      return;
    }
    void this.context.globalState.update(NOTIFIED_KEY, key);
    void vscode.window.showWarningMessage(`Argus: ${TRACKING_MESSAGE[this.current]}`, "Set Up Session Tracking").then((choice) => {
      if (choice) {
        void vscode.commands.executeCommand("argus.sessions.installHooks");
      }
    });
  }

  public dispose(): void {
    this.focus.dispose();
    this.emitter.dispose();
  }
}
