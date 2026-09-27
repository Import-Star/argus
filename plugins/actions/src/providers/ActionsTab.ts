import * as vscode from "vscode";
import type { ArgusTab, TabHandle } from "../../../../api";
import { ActionsService, DispatchWorkflow, PendingApproval } from "../services/ActionsService";

interface GenericMessage {
  type: string;
  [key: string]: unknown;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringRecord(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!value || typeof value !== "object") {
    return result;
  }
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    result[key] = typeof raw === "string" ? raw : String(raw);
  }
  return result;
}

// Wires the Actions tab (media/actions.js) to ActionsService: posts state on every change and on "ready",
// and handles the tab's messages, including the modal confirmations for approve/reject/dispatch/re-run/cancel.
export class ActionsTab implements ArgusTab {
  public readonly id = "actions";
  public readonly title = "Actions";
  public readonly order = 20;
  public readonly script: vscode.Uri;
  public readonly style: vscode.Uri;

  private handle?: TabHandle;
  private readonly changeListener: vscode.Disposable;

  public constructor(
    extensionUri: vscode.Uri,
    private readonly actions: ActionsService
  ) {
    this.script = vscode.Uri.joinPath(extensionUri, "media", "actions.js");
    this.style = vscode.Uri.joinPath(extensionUri, "media", "actions.css");
    this.changeListener = actions.onDidChange((state) => {
      this.handle?.post({ type: "state", state });
      const mine = state.approvals.filter((approval) => approval.environments.some((env) => env.canApprove));
      this.handle?.setBadge(mine.length || undefined);
    });
  }

  public setHandle(handle: TabHandle): void {
    this.handle = handle;
  }

  public dispose(): void {
    this.changeListener.dispose();
  }

  public onDidChangeVisibility(visible: boolean): void {
    this.actions.setActive(visible);
  }

  public async onMessage(message: unknown): Promise<void> {
    const generic = message as GenericMessage;
    if (!generic || typeof generic.type !== "string") {
      return;
    }
    switch (generic.type) {
      case "ready":
        this.handle?.post({ type: "state", state: this.actions.getState() });
        return;
      case "actionsRefresh":
        await this.actions.refresh();
        return;
      case "loadJobs": {
        const runId = asNumber(generic.runId);
        if (runId === undefined) {
          return;
        }
        const repo = this.actions.getState().repo;
        if (!repo) {
          return;
        }
        const jobs = await this.actions.jobs(repo, runId).catch(() => []);
        this.handle?.post({ type: "jobs", runId, jobs });
        return;
      }
      case "reviewRun":
        await this.reviewRun(asNumber(generic.runId), generic.approve === true);
        return;
      case "dispatchWorkflow":
        await this.dispatchWorkflow(asNumber(generic.workflowId), asString(generic.ref, "main"), asStringRecord(generic.inputs));
        return;
      case "rerunFailed": {
        const runId = asNumber(generic.runId);
        if (runId === undefined) {
          return;
        }
        await this.confirmThen(`Re-run failed jobs of run ${runId}?`, "Re-run", () => this.actions.rerunFailed(runId));
        return;
      }
      case "cancelRun": {
        const runId = asNumber(generic.runId);
        if (runId === undefined) {
          return;
        }
        await this.confirmThen(`Cancel run ${runId}?`, "Cancel run", () => this.actions.cancel(runId));
        return;
      }
      default:
        return;
    }
  }

  private async confirmThen(question: string, action: string, run: () => Promise<void>, detail?: string): Promise<void> {
    const choice = await vscode.window.showWarningMessage(question, { modal: true, detail }, action);
    if (choice !== action) {
      return;
    }
    try {
      await run();
    } catch (error) {
      void vscode.window.showErrorMessage(`Argus Actions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private findApproval(runId: number | undefined): PendingApproval | undefined {
    if (runId === undefined) {
      return undefined;
    }
    return this.actions.getState().approvals.find((candidate) => candidate.run.id === runId);
  }

  private findWorkflow(workflowId: number | undefined): DispatchWorkflow | undefined {
    if (workflowId === undefined) {
      return undefined;
    }
    return this.actions.getState().workflows.find((candidate) => candidate.id === workflowId);
  }

  private async reviewRun(runId: number | undefined, approve: boolean): Promise<void> {
    const approval = this.findApproval(runId);
    if (!approval) {
      return;
    }
    const envs = approval.environments.filter((env) => env.canApprove).map((env) => env.name);
    const detail = [
      `${approval.run.name}${approval.run.app ? ` · ${approval.run.app}` : ""} on ${approval.run.branch}, started by ${approval.run.actor}`,
      `Environments: ${envs.join(", ")}`,
      ...approval.gates.map((gate) => `Waiting job: ${gate}`)
    ].join("\n");
    const comment = await vscode.window.showInputBox({
      title: `${approve ? "Approve" : "Reject"} ${approval.run.name}`,
      prompt: detail.replace(/\n/g, " · "),
      placeHolder: "Optional comment"
    });
    if (comment === undefined) {
      return;
    }
    await this.confirmThen(`${approve ? "Approve" : "Reject"} ${approval.run.name}?`, approve ? "Approve" : "Reject", () => this.actions.review(approval, approve, comment), detail);
  }

  private async dispatchWorkflow(workflowId: number | undefined, ref: string, inputs: Record<string, string>): Promise<void> {
    const workflow = this.findWorkflow(workflowId);
    if (!workflow) {
      return;
    }
    const detail = [`Branch: ${ref}`, ...Object.entries(inputs).map(([key, value]) => `${key}: ${value}`)].join("\n");
    await this.confirmThen(`Run ${workflow.name}?`, "Run workflow", () => this.actions.dispatch(workflow, ref, inputs), detail);
  }
}
