import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";

export interface UsageWindow {
  key: string;
  label: string;
  utilization: number;
  resetsAt?: Date;
}

export interface UsageExtra {
  enabled: boolean;
  usedCredits?: number;
  monthlyLimit?: number;
  utilization?: number;
}

export interface UsageState {
  loading: boolean;
  windows: UsageWindow[];
  extra?: UsageExtra;
  breakdown: { label: string; percent: number }[];
  plan?: string;
  fetchedAt?: Date;
  error?: string;
}

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const LABELS: Record<string, string> = {
  five_hour: "Current session (5 hour)",
  seven_day: "Weekly (all models)",
  seven_day_opus: "Weekly (Opus)",
  seven_day_sonnet: "Weekly (Sonnet)",
  seven_day_oauth_apps: "Weekly (OAuth apps)"
};

interface Credentials {
  accessToken: string;
  expiresAt?: number;
  subscriptionType?: string;
}

const execFileAsync = promisify(execFile);

// Claude Code keeps its login in ~/.claude/.credentials.json, or in the login keychain on macOS.
async function readCredentials(): Promise<Credentials> {
  let raw: string | undefined;
  try {
    raw = fs.readFileSync(path.join(os.homedir(), ".claude", ".credentials.json"), "utf8");
  } catch {
    if (process.platform === "darwin") {
      try {
        raw = (await execFileAsync("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], { timeout: 5000 })).stdout;
      } catch {
        raw = undefined;
      }
    }
  }
  let creds: Credentials | undefined;
  try {
    creds = (JSON.parse(raw ?? "") as { claudeAiOauth?: Credentials }).claudeAiOauth;
  } catch {
    creds = undefined;
  }
  if (!creds?.accessToken) {
    throw new Error("Not signed in to Claude Code with a Claude subscription. Sign in with /login, then refresh.");
  }
  return creds;
}

export class UsageService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<UsageState>();
  private timer: NodeJS.Timeout;
  private inFlight?: Promise<void>;
  private state: UsageState = { loading: true, windows: [], breakdown: [] };

  public readonly onDidChange = this.emitter.event;

  public constructor(initialIntervalMs: number) {
    this.timer = setInterval(() => void this.refresh(), initialIntervalMs);
    void this.refresh();
  }

  public getState(): UsageState {
    return this.state;
  }

  public refresh(): Promise<void> {
    this.inFlight ??= this.load().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  public setInterval(intervalMs: number): void {
    clearInterval(this.timer);
    this.timer = setInterval(() => void this.refresh(), intervalMs);
  }

  public dispose(): void {
    clearInterval(this.timer);
    this.emitter.dispose();
  }

  private set(state: UsageState): void {
    this.state = state;
    this.emitter.fire(state);
  }

  private async load(): Promise<void> {
    this.set({ ...this.state, loading: true });
    try {
      const creds = await readCredentials();
      if (creds.expiresAt && creds.expiresAt < Date.now()) {
        throw new Error("Claude login has expired. Use Claude Code once to refresh it, then refresh here.");
      }
      const response = await fetch(USAGE_URL, {
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          "anthropic-beta": "oauth-2025-04-20",
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(15_000)
      });
      if (response.status === 401 || response.status === 403) {
        throw new Error("Claude login was rejected. Use Claude Code once to refresh it, then refresh here.");
      }
      if (!response.ok) {
        throw new Error(`Usage request failed (HTTP ${response.status}).`);
      }
      const body = (await response.json()) as Record<string, unknown>;
      this.set({
        loading: false,
        windows: parseWindows(body),
        extra: parseExtra(body.extra_usage),
        breakdown: parseBreakdown(body.seven_day_breakdown),
        plan: creds.subscriptionType,
        fetchedAt: new Date()
      });
    } catch (error) {
      this.set({ ...this.state, loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

function parseWindows(body: Record<string, unknown>): UsageWindow[] {
  const windows: UsageWindow[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (!(key in LABELS)) {
      continue;
    }
    const window = value as { utilization?: unknown; resets_at?: unknown } | null;
    if (!window || typeof window !== "object" || typeof window.utilization !== "number") {
      continue;
    }
    windows.push({
      key,
      label: LABELS[key] ?? key.replace(/_/g, " "),
      utilization: window.utilization,
      resetsAt: typeof window.resets_at === "string" ? new Date(window.resets_at) : undefined
    });
  }
  const order = Object.keys(LABELS);
  return windows.sort((a, b) => (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99));
}

function parseExtra(value: unknown): UsageExtra | undefined {
  const extra = value as { is_enabled?: boolean; used_credits?: number; monthly_limit?: number; utilization?: number } | null;
  if (!extra || typeof extra !== "object") {
    return undefined;
  }
  return {
    enabled: Boolean(extra.is_enabled),
    usedCredits: extra.used_credits,
    monthlyLimit: extra.monthly_limit,
    utilization: extra.utilization
  };
}

function parseBreakdown(value: unknown): UsageState["breakdown"] {
  const rows = (value as { rows?: { display_name?: string; percent?: number }[] } | null)?.rows;
  return (rows ?? []).filter((row) => row.display_name && typeof row.percent === "number").map((row) => ({ label: row.display_name as string, percent: row.percent as number }));
}
