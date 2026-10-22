import * as path from "path";
import * as vscode from "vscode";
import type { ActivateChat, ChatDeps, ChatHost } from "./types";

// The chat bundle carries the Agent SDK, so it is only loaded while argus.chat.enabled is on.
export class ChatLoader implements vscode.Disposable {
  private current?: ChatHost;
  private readonly emitter = new vscode.EventEmitter<ChatHost | undefined>();
  public readonly onDidChange = this.emitter.event;
  private readonly listener: vscode.Disposable;

  constructor(private readonly context: vscode.ExtensionContext, private readonly deps: ChatDeps) {
    this.listener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("argus.chat.enabled")) {
        this.apply();
      }
    });
  }

  public get host(): ChatHost | undefined {
    return this.current;
  }

  public apply(): void {
    const enabled = vscode.workspace.getConfiguration("argus.chat").get<boolean>("enabled", false);
    if (enabled && !this.current) {
      try {
        const bundle = require(path.join(this.context.extensionPath, "out", "chat", "host.js")) as { activateChat: ActivateChat };
        this.current = bundle.activateChat(this.context, this.deps);
      } catch (error) {
        void vscode.window.showErrorMessage(`Argus: could not start chat: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
    } else if (!enabled && this.current) {
      this.current.dispose();
      this.current = undefined;
    } else {
      return;
    }
    this.emitter.fire(this.current);
  }

  public dispose(): void {
    this.listener.dispose();
    this.current?.dispose();
    this.emitter.dispose();
  }
}
