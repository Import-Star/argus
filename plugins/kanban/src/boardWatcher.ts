import * as path from "path";
import * as vscode from "vscode";

// Watches the board file (and its creation, so a file added after the tab loaded is picked up without
// needing "Create board" to have been clicked in this session).
export class BoardWatcher {
  private watcher?: vscode.FileSystemWatcher;
  private timer?: NodeJS.Timeout;

  public watch(uri: vscode.Uri, onChange: () => void): void {
    this.dispose();

    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
      return;
    }

    const relativePath = path.relative(folder.uri.fsPath, uri.fsPath).replaceAll(path.sep, "/");
    const pattern = new vscode.RelativePattern(folder, relativePath);
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const debounced = () => {
      if (this.timer) {
        clearTimeout(this.timer);
      }
      this.timer = setTimeout(() => {
        onChange();
      }, 250);
    };

    this.watcher.onDidChange(debounced);
    this.watcher.onDidCreate(debounced);
    this.watcher.onDidDelete(debounced);
  }

  public dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.watcher?.dispose();
    this.watcher = undefined;
  }
}
