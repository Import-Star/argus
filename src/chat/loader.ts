import * as path from "path";
import * as vscode from "vscode";
import type { ActivateChat, ChatDeps, ChatHost } from "./types";

// Sessions open in Argus chat. Its bundle carries the Agent SDK, so it loads after the board is up.
export class ChatLoader implements vscode.Disposable {
  private current?: ChatHost;
  private readonly emitter = new vscode.EventEmitter<ChatHost | undefined>();
  public readonly onDidChange = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext, private readonly deps: ChatDeps) {}

  public get host(): ChatHost | undefined {
    return this.current;
  }

  public apply(): void {
    if (this.current) {
      return;
    }
    try {
      const bundle = require(path.join(this.context.extensionPath, "out", "chat", "host.js")) as { activateChat: ActivateChat };
      this.current = bundle.activateChat(this.context, this.deps);
    } catch (error) {
      void vscode.window.showErrorMessage(`Argus: could not start chat: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    this.emitter.fire(this.current);
  }

  public dispose(): void {
    this.current?.dispose();
    this.emitter.dispose();
  }
}
