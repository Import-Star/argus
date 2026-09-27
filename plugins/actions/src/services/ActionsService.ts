import { execFile } from "child_process";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";
import { checkGhAvailable, gh, ghJson, ghPost } from "./gh";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const yaml = require(path.join(__dirname, "..", "..", "vendor", "js-yaml.min.js")) as { load(text: string): unknown };

export interface WorkflowInput {
  name: string;
  description?: string;
  type: "choice" | "boolean" | "number" | "string" | "environment";
  options?: string[];
  default?: string;
  required?: boolean;
}

export interface DispatchWorkflow {
  id: number;
  name: string;
  file: string;
  inputs: WorkflowInput[];
}

export interface RunJob {
  name: string;
  status: string;
  conclusion?: string;
}

export interface Run {
  id: number;
  name: string;
  title: string;
  status: string;
  conclusion?: string;
  event: string;
  branch: string;
  actor: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  attempt: number;
  app?: string;
  currentJob?: string;
  jobs?: RunJob[];
}

export interface PendingApproval {
  run: Run;
  environments: Array<{ id: number; name: string; canApprove: boolean; reviewers: string[] }>;
  gates: string[];
}

export interface ActionsState {
  repo: string;
  me?: string;
  runs: Run[];
  approvals: PendingApproval[];
  workflows: DispatchWorkflow[];
  error?: string;
  fetchedAt?: number;
}

interface ApiRun {
  id: number;
  name: string;
  display_title: string;
  status: string;
  conclusion: string | null;
  event: string;
  head_branch: string | null;
  actor: { login: string } | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  run_attempt: number;
}

interface ApiJob {
  name: string;
  status: string;
  conclusion: string | null;
}

const WORKFLOWS_TTL_MS = 30 * 60_000;
const execFileAsync = promisify(execFile);
const GITHUB_REMOTE = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// Optional user pattern (argus.actions.appPattern). Its first capture group, or the whole match, names the app a run touches.
function appPattern(): RegExp | undefined {
  const source = vscode.workspace.getConfiguration("argus").get<string>("actions.appPattern", "").trim();
  if (!source) {
    return undefined;
  }
  try {
    return new RegExp(source);
  } catch {
    return undefined;
  }
}

function toStr(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}

export class ActionsService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<ActionsState>();
  public readonly onDidChange = this.emitter.event;
  private state: ActionsState;
  private readonly finishedJobs = new Map<string, RunJob[]>();
  private workflowsLoadedAt = 0;
  private readonly focusListener: vscode.Disposable;
  private readonly configListener: vscode.Disposable;
  private timer?: NodeJS.Timeout;
  private active = false;
  private inFlight?: Promise<void>;
  private backgroundInFlight?: Promise<void>;

  public constructor() {
    this.state = { repo: "", runs: [], approvals: [], workflows: [] };
    this.schedule();
    void this.refresh();
    this.focusListener = vscode.window.onDidChangeWindowState((window) => {
      if (window.focused) {
        void (this.active ? this.refresh() : this.refreshApprovals());
      }
    });
    this.configListener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("argus.actions")) {
        this.workflowsLoadedAt = 0;
        this.schedule();
        void this.refresh();
      }
    });
  }

  public getState(): ActionsState {
    return this.state;
  }

  // The Actions tab does a full load while visible; otherwise only approvals are checked, slowly.
  public setActive(active: boolean): void {
    if (this.active === active) {
      return;
    }
    this.active = active;
    this.schedule();
    if (active) {
      void this.refresh();
    }
  }

  public refresh(): Promise<void> {
    this.inFlight ??= this.load().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  public async jobs(repo: string, runId: number): Promise<RunJob[]> {
    const cacheKey = `${repo}#${runId}`;
    const cached = this.finishedJobs.get(cacheKey);
    if (cached) {
      return cached;
    }
    const { jobs } = await ghJson<{ jobs: ApiJob[] }>(`repos/${repo}/actions/runs/${runId}/jobs?per_page=100`);
    const mapped = jobs.map((job) => ({ name: job.name, status: job.status, conclusion: job.conclusion ?? undefined }));
    if (jobs.every((job) => job.status === "completed")) {
      this.finishedJobs.set(cacheKey, mapped);
    }
    return mapped;
  }

  public async review(approval: PendingApproval, approve: boolean, comment: string): Promise<void> {
    const ids = approval.environments.filter((env) => env.canApprove).map((env) => env.id);
    await ghPost(`repos/${this.state.repo}/actions/runs/${approval.run.id}/pending_deployments`, {
      environment_ids: ids,
      state: approve ? "approved" : "rejected",
      comment
    });
    await this.refresh();
  }

  public async dispatch(workflow: DispatchWorkflow, ref: string, inputs: Record<string, string>): Promise<void> {
    await ghPost(`repos/${this.state.repo}/actions/workflows/${workflow.id}/dispatches`, { ref, inputs });
    setTimeout(() => void this.refresh(), 3000);
  }

  public async rerunFailed(runId: number): Promise<void> {
    await ghPost(`repos/${this.state.repo}/actions/runs/${runId}/rerun-failed-jobs`, {});
    setTimeout(() => void this.refresh(), 3000);
  }

  public async cancel(runId: number): Promise<void> {
    await ghPost(`repos/${this.state.repo}/actions/runs/${runId}/cancel`, {});
    setTimeout(() => void this.refresh(), 3000);
  }

  public dispose(): void {
    this.focusListener.dispose();
    this.configListener.dispose();
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.emitter.dispose();
  }

  // No repo, no timer: nothing to poll for until one resolves (a config change or the window regaining focus
  // triggers a fresh attempt).
  private schedule(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (!this.state.repo) {
      return;
    }
    const config = vscode.workspace.getConfiguration("argus");
    const seconds = this.active ? config.get<number>("actions.refreshSeconds", 30) : config.get<number>("actions.backgroundRefreshSeconds", 120);
    this.timer = setInterval(() => void (this.active ? this.refresh() : this.refreshApprovals()), Math.max(10, seconds) * 1000);
  }

  private configuredRepo(): { repo?: string; error?: string } {
    const raw = vscode.workspace.getConfiguration("argus").get<string>("actions.repo", "").trim();
    if (!raw) {
      return {};
    }
    if (!REPO_PATTERN.test(raw)) {
      return { error: `Invalid argus.actions.repo "${raw}": expected "owner/name".` };
    }
    return { repo: raw };
  }

  // The setting wins; otherwise use the GitHub origin remote of the first workspace folder that has one.
  private async resolveRepo(): Promise<{ repo?: string; error?: string }> {
    const configured = this.configuredRepo();
    if (configured.repo || configured.error) {
      return configured;
    }
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      try {
        const { stdout } = await execFileAsync("git", ["-C", folder.uri.fsPath, "remote", "get-url", "origin"], { timeout: 5000 });
        const match = stdout.trim().match(GITHUB_REMOTE);
        if (match) {
          return { repo: match[1] };
        }
      } catch {
        // Not a git folder or no origin; try the next one.
      }
    }
    return {};
  }

  // Background refresh: approvals only (waiting runs, their pending_deployments and jobs). That is all the
  // status bar item and the tab badge need, so it's cheap enough to run while the tab isn't visible.
  private refreshApprovals(): Promise<void> {
    this.backgroundInFlight ??= this.loadApprovals().finally(() => {
      this.backgroundInFlight = undefined;
    });
    return this.backgroundInFlight;
  }

  private async loadApprovals(): Promise<void> {
    const hadRepo = Boolean(this.state.repo);
    const { repo, error } = await this.resolveRepo();
    if (!repo) {
      this.state = { ...this.state, repo: "", approvals: [], error: error ?? this.noRepoMessage() };
      this.emitter.fire(this.state);
      if (hadRepo) {
        this.schedule();
      }
      return;
    }
    try {
      const waiting = await ghJson<{ workflow_runs: ApiRun[] }>(`repos/${repo}/actions/runs?status=waiting&per_page=30`);
      const approvals = await Promise.all(waiting.workflow_runs.map((run) => this.approvalFor(repo, run)));
      this.state = { ...this.state, repo, approvals: approvals.filter((a) => a.environments.length > 0), error: undefined, fetchedAt: Date.now() };
    } catch (error) {
      this.state = { ...this.state, repo, error: error instanceof Error ? error.message : String(error) };
    }
    if (!hadRepo) {
      this.schedule();
    }
    this.emitter.fire(this.state);
  }

  private noRepoMessage(): string {
    return "No GitHub repo found. Open a folder with a GitHub origin remote, or set argus.actions.repo (owner/name).";
  }

  private async load(): Promise<void> {
    const hadRepo = Boolean(this.state.repo);
    const { repo, error } = await this.resolveRepo();
    if (!repo) {
      this.state = { ...this.state, repo: "", runs: [], approvals: [], error: error ?? this.noRepoMessage() };
      this.emitter.fire(this.state);
      if (hadRepo) {
        this.schedule();
      }
      return;
    }
    if (!hadRepo) {
      this.schedule();
    }
    const availability = await checkGhAvailable();
    if (!availability.ok) {
      this.state = { ...this.state, repo, error: availability.message };
      this.emitter.fire(this.state);
      return;
    }
    try {
      const me = this.state.me ?? (await gh(["api", "user", "--jq", ".login"])).trim();
      const waiting = await ghJson<{ workflow_runs: ApiRun[] }>(`repos/${repo}/actions/runs?status=waiting&per_page=30`);
      const approvals = await Promise.all(waiting.workflow_runs.map((run) => this.approvalFor(repo, run)));
      const lists = await Promise.all(
          [`per_page=40`, `event=workflow_dispatch&per_page=30`, `actor=${me}&per_page=30`].map((query) =>
            ghJson<{ workflow_runs: ApiRun[] }>(`repos/${repo}/actions/runs?${query}`)
          )
        );
      const byId = new Map(lists.flatMap((list) => list.workflow_runs).map((run) => [run.id, toRun(run)]));
      const runs = await this.withJobs(repo, [...byId.values()].sort((x, y) => y.createdAt.localeCompare(x.createdAt)));
      let workflows = this.state.workflows;
      if (Date.now() - this.workflowsLoadedAt > WORKFLOWS_TTL_MS) {
        workflows = await this.loadWorkflows(repo);
        this.workflowsLoadedAt = Date.now();
      }
      this.state = { ...this.state, repo, me, runs, workflows, approvals: approvals.filter((a) => a.environments.length > 0), error: undefined, fetchedAt: Date.now() };
    } catch (error) {
      this.state = { ...this.state, repo, error: error instanceof Error ? error.message : String(error) };
    }
    this.emitter.fire(this.state);
  }

  private async approvalFor(repo: string, apiRun: ApiRun): Promise<PendingApproval> {
    const pending = await ghJson<Array<{
      environment: { id: number; name: string };
      current_user_can_approve: boolean;
      reviewers: Array<{ reviewer: { login?: string; name?: string; slug?: string } }>;
    }>>(`repos/${repo}/actions/runs/${apiRun.id}/pending_deployments`);
    const run = toRun(apiRun);
    const jobs = await this.jobs(repo, run.id).catch(() => []);
    run.jobs = jobs;
    run.app = appFrom(jobs);
    return {
      run,
      environments: pending.map((p) => ({
        id: p.environment.id,
        name: p.environment.name,
        canApprove: p.current_user_can_approve,
        reviewers: p.reviewers.map((r) => r.reviewer.login ?? r.reviewer.slug ?? r.reviewer.name ?? "?")
      })),
      gates: jobs.filter((job) => job.status === "waiting").map((job) => job.name)
    };
  }

  // Deploy titles don't say which app; the job names do, so fetch jobs for manual runs and anything running.
  private async withJobs(repo: string, runs: Run[]): Promise<Run[]> {
    const wanted = runs.filter((run) => run.event === "workflow_dispatch" || run.status !== "completed").slice(0, 25);
    await Promise.all(
      wanted.map(async (run) => {
        const jobs = await this.jobs(repo, run.id).catch(() => undefined);
        if (!jobs) {
          return;
        }
        run.jobs = jobs;
        run.app = appFrom(jobs);
        run.currentJob = jobs.find((job) => job.status === "in_progress" || job.status === "waiting")?.name;
      })
    );
    return runs;
  }

  private async loadWorkflows(repo: string): Promise<DispatchWorkflow[]> {
    const { workflows } = await ghJson<{ workflows: Array<{ id: number; name: string; path: string; state: string }> }>(
      `repos/${repo}/actions/workflows?per_page=100`
    );
    const active = workflows.filter((workflow) => workflow.state === "active" && workflow.path.startsWith(".github/workflows/"));
    const parsed = await Promise.all(
      active.map(async (workflow) => {
        const raw = await gh(["api", `repos/${repo}/contents/${workflow.path}`, "--jq", ".content"]).catch(() => "");
        let doc: { on?: unknown } | undefined;
        try {
          doc = yaml.load(Buffer.from(raw.trim(), "base64").toString("utf8")) as { on?: unknown } | undefined;
        } catch {
          doc = undefined;
        }
        const on = doc?.on;
        const dispatch = typeof on === "object" && on !== null && "workflow_dispatch" in on ? (on as Record<string, unknown>).workflow_dispatch : undefined;
        const isDispatch = on === "workflow_dispatch" || (Array.isArray(on) && on.includes("workflow_dispatch")) || dispatch !== undefined;
        if (!isDispatch) {
          return undefined;
        }
        const rawInputs = ((dispatch as { inputs?: Record<string, Record<string, unknown>> } | null)?.inputs ?? {}) as Record<string, Record<string, unknown>>;
        const inputs: WorkflowInput[] = Object.entries(rawInputs).map(([name, spec]) => {
          const type = toStr(spec?.type) ?? "string";
          return {
            name: String(name),
            description: toStr(spec?.description),
            type: (["choice", "boolean", "number", "string", "environment"].includes(type) ? type : "string") as WorkflowInput["type"],
            options: Array.isArray(spec?.options) ? spec.options.map((option) => String(option)) : undefined,
            default: toStr(spec?.default),
            required: Boolean(spec?.required)
          };
        });
        return { id: workflow.id, name: String(workflow.name), file: path.basename(workflow.path), inputs };
      })
    );
    return parsed.filter((workflow): workflow is DispatchWorkflow => Boolean(workflow)).sort((a, b) => a.name.localeCompare(b.name));
  }
}

function toRun(run: ApiRun): Run {
  return {
    id: run.id,
    name: run.name,
    title: run.display_title,
    status: run.status,
    conclusion: run.conclusion ?? undefined,
    event: run.event,
    branch: run.head_branch ?? "",
    actor: run.actor?.login ?? "?",
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    url: run.html_url,
    attempt: run.run_attempt
  };
}

function appFrom(jobs: RunJob[]): string | undefined {
  const pattern = appPattern();
  if (!pattern) {
    return undefined;
  }
  const apps = [...new Set(jobs.map((job) => job.name.match(pattern)).map((match) => match?.[1] ?? match?.[0]).filter((app): app is string => Boolean(app)))];
  return apps.length > 2 ? "all apps" : apps.join(", ") || undefined;
}
