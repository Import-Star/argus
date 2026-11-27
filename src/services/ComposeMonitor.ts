import * as vscode from "vscode";
import { SessionRecord } from "../types";
import { ComposeProject, composeProjects, ownsProject } from "./composeStacks";
import { SessionStore } from "./SessionStore";

// The WSL distro whose Docker Engine to use on Windows, or undefined for `docker` on PATH.
export function wslDistro(): string | undefined {
  return vscode.workspace.getConfiguration("argus.docker").get<string>("wslDistro", "").trim() || undefined;
}

// Polls Docker while the window has focus and some session could own a Compose project.
export class ComposeMonitor implements vscode.Disposable {
  private projects: ComposeProject[] = [];
  private readonly changed = new vscode.EventEmitter<void>();
  public readonly onDidChange = this.changed.event;
  private readonly timer = setInterval(() => void this.refresh(), 10_000);
  private readonly focus = vscode.window.onDidChangeWindowState(() => void this.refresh());

  public constructor(private readonly sessions: SessionStore) {
    void this.refresh();
  }

  public forSession(record: SessionRecord): ComposeProject[] {
    return this.projects.filter((project) => ownsProject(record, project));
  }

  private async refresh(): Promise<void> {
    if (!vscode.window.state.focused || !this.sessions.getCards().some((card) => card.record.composeStacks?.length || card.record.worktrees?.length)) {
      return;
    }
    const projects = await composeProjects(wslDistro());
    if (JSON.stringify(projects) !== JSON.stringify(this.projects)) {
      this.projects = projects;
      this.changed.fire();
    }
  }

  public dispose(): void {
    clearInterval(this.timer);
    this.focus.dispose();
    this.changed.dispose();
  }
}
