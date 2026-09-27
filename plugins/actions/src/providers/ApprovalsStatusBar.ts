import * as vscode from "vscode";
import { ActionsService } from "../services/ActionsService";

// A status bar item showing the number of Actions runs the current user can approve. Clicking it opens the
// Actions tab.
export class ApprovalsStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly listener: vscode.Disposable;

  public constructor(actions: ActionsService) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 999);
    this.item.command = "argus.actions.open";
    this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    this.listener = actions.onDidChange((state) => {
      const mine = state.approvals.filter((approval) => approval.environments.some((env) => env.canApprove));
      if (mine.length === 0) {
        this.item.hide();
        return;
      }
      this.item.text = `$(debug-pause) ${mine.length} approval${mine.length > 1 ? "s" : ""}`;
      this.item.tooltip = mine.map((approval) => `${approval.run.name}${approval.run.app ? ` · ${approval.run.app}` : ""} (${approval.run.actor})`).join("\n");
      this.item.show();
    });
  }

  public dispose(): void {
    this.listener.dispose();
    this.item.dispose();
  }
}

export function approvalsForMe(state: { approvals: Array<{ environments: Array<{ canApprove: boolean }> }> }): number {
  return state.approvals.filter((approval) => approval.environments.some((env) => env.canApprove)).length;
}
