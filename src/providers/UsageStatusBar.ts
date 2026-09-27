import * as vscode from "vscode";
import { UsageService, UsageState, UsageWindow } from "../services/UsageService";

function bar(percent: number, width = 20): string {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function timeLeft(date?: Date): string {
  if (!date) {
    return "";
  }
  const minutes = Math.max(0, Math.round((date.getTime() - Date.now()) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  return days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function untilReset(date?: Date): string {
  return date ? `resets in ${timeLeft(date)}` : "";
}

function windowIcon(window: UsageWindow): string {
  return window.utilization >= 90 ? "✕" : window.utilization >= 75 ? "⚠" : "✓";
}

export class UsageStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
  private readonly disposables: vscode.Disposable[] = [];
  private readonly tick: NodeJS.Timeout;
  private panel?: vscode.QuickPick<vscode.QuickPickItem>;
  private refreshMinutes: number;

  public constructor(private readonly usage: UsageService) {
    this.item.command = "argus.usage.show";
    this.refreshMinutes = vscode.workspace.getConfiguration("argus.usage").get<number>("refreshMinutes", 5);
    this.disposables.push(usage.onDidChange(() => this.render()));
    // Re-render so "resets in" countdowns stay current between fetches.
    this.tick = setInterval(() => this.render(), 60_000);
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("argus.usage.refreshMinutes")) {
          const newMinutes = vscode.workspace.getConfiguration("argus.usage").get<number>("refreshMinutes", 5);
          if (newMinutes !== this.refreshMinutes) {
            this.refreshMinutes = newMinutes;
            this.usage.setInterval(Math.max(1, newMinutes) * 60_000);
            if (this.panel) {
              this.updatePanel();
            }
          }
        }
      })
    );
    this.render();
    this.item.show();
  }

  public show(): void {
    if (this.panel) {
      return;
    }
    const refreshButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon("refresh"), tooltip: "Refresh usage" };
    const panel = vscode.window.createQuickPick();
    this.panel = panel;
    panel.title = "Claude plan usage";
    panel.buttons = [refreshButton];
    panel.canSelectMany = false;
    panel.matchOnDescription = false;
    const subscription = this.usage.onDidChange(() => this.updatePanel());
    panel.onDidTriggerButton(() => void this.usage.refresh());
    panel.onDidAccept(() => void this.usage.refresh());
    panel.onDidHide(() => {
      subscription.dispose();
      panel.dispose();
      this.panel = undefined;
    });
    this.updatePanel();
    panel.show();
    void this.usage.refresh();
  }

  public dispose(): void {
    clearInterval(this.tick);
    this.panel?.dispose();
    this.item.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private updatePanel(): void {
    if (!this.panel) {
      return;
    }
    this.panel.busy = this.usage.getState().loading;
    this.panel.items = this.buildItems(this.usage.getState());
  }

  private buildItems(state: UsageState): vscode.QuickPickItem[] {
    const items: vscode.QuickPickItem[] = [];
    if (state.error) {
      items.push({ label: `$(error) ${state.error}` });
    }
    for (const window of state.windows) {
      const percent = Math.round(window.utilization);
      items.push({ label: `${windowIcon(window)} ${window.label}`, kind: vscode.QuickPickItemKind.Separator });
      items.push({ label: `${bar(window.utilization)}  ${percent}%`, description: untilReset(window.resetsAt) });
    }
    if (state.breakdown.length > 0) {
      items.push({ label: "Weekly usage by product", kind: vscode.QuickPickItemKind.Separator });
      for (const row of state.breakdown) {
        items.push({ label: `${bar(row.percent)}  ${Math.round(row.percent)}%`, description: row.label });
      }
    }
    const extra = state.extra;
    if (extra?.enabled) {
      items.push({ label: "Extra usage", kind: vscode.QuickPickItemKind.Separator });
      const pct = extra.utilization ?? 0;
      const used = extra.usedCredits !== undefined ? `$${(extra.usedCredits / 100).toFixed(2)} used` : "";
      const money = extra.monthlyLimit ? `${used} of $${(extra.monthlyLimit / 100).toFixed(2)}` : used;
      items.push(extra.monthlyLimit ? { label: `${bar(pct)}  ${Math.round(pct)}%`, description: money } : { label: `$(credit-card) ${money || "Enabled"}` });
    }
    if (state.windows.length === 0 && !state.error) {
      items.push({ label: state.loading ? "$(sync~spin) Loading usage…" : "No usage data returned." });
    }
    items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
    const plan = state.plan ? `${state.plan[0].toUpperCase()}${state.plan.slice(1)} plan · ` : "";
    const updated = state.fetchedAt ? `updated ${state.fetchedAt.toLocaleTimeString()}` : "not yet updated";
    items.push({ label: `$(refresh) Refresh`, description: `${plan}${updated} · auto-refreshes every ${this.refreshMinutes} min` });
    return items;
  }

  private render(): void {
    const state = this.usage.getState();
    const session = state.windows.find((window) => window.key === "five_hour") ?? state.windows[0];
    if (!session) {
      this.item.text = state.error ? "$(warning) Claude usage" : "$(sync~spin) Claude usage";
      this.item.backgroundColor = undefined;
      this.item.tooltip = state.error ?? "Loading Claude plan usage…";
      return;
    }
    const spinner = state.loading ? " $(sync~spin)" : "";
    this.item.text = `$(pulse) ${Math.round(session.utilization)}%${session.resetsAt ? ` · resets ${timeLeft(session.resetsAt)}` : ""}${spinner}`;
    const worst = Math.max(...state.windows.map((window) => window.utilization));
    this.item.backgroundColor = worst >= 90 ? new vscode.ThemeColor("statusBarItem.errorBackground") : worst >= 75 ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
    this.item.tooltip = `Claude plan usage — click for breakdown\n${state.windows.map((window) => `${window.label}: ${Math.round(window.utilization)}% ${untilReset(window.resetsAt)}`).join("\n")}`;
  }
}
