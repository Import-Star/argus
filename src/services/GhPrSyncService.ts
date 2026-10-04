import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as vscode from "vscode";
import { parsePullRequestLinks, PullRequestRef } from "./PrLinkParser";
import { PrCheck, PrSummary } from "../types";

const execFileAsync = promisify(execFile);

interface PrCacheItem {
  expiresAt: number;
  data: PrSummary;
}

interface GhReview {
  state?: string;
  author?: { login?: string };
}

interface GhStatusCheck {
  context?: string;
  name?: string;
  status?: string;
  conclusion?: string;
}

interface GhPrNode {
  title?: string;
  url?: string;
  state?: string;
  isDraft?: boolean;
  reviewDecision?: string;
  reviews?: { nodes?: GhReview[] };
  commits?: { nodes?: Array<{ commit?: { statusCheckRollup?: { contexts?: { nodes?: GhStatusCheck[] } } | null } }> };
}

interface GhBatchResponse {
  data?: Record<string, { pullRequest?: GhPrNode | null } | null>;
  errors?: Array<{ path?: string[]; message?: string }>;
}

const BATCH_SIZE = 50;
const PR_FIELDS = `title url state isDraft reviewDecision
  reviews(last: 100) { nodes { state author { login } } }
  commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
    ... on CheckRun { name status conclusion }
    ... on StatusContext { context }
  } } } } } }`;

export class GhPrSyncService {
  private readonly cache = new Map<string, PrCacheItem>();
  private ghPath: string | null | undefined;

  // Canonical PR URL -> summary. Used both for session cards and for ArgusApi.prs.get.
  public async summarize(urls: string[], skipCache = false): Promise<Map<string, PrSummary>> {
    const result = new Map<string, PrSummary>();
    const availability = await this.checkGhAvailable();
    if (!availability.ok) {
      return result;
    }
    const now = Date.now();
    const stale: PullRequestRef[] = [];
    for (const ref of urls.flatMap((url) => parsePullRequestLinks(url))) {
      const cached = this.cache.get(ref.key);
      // A merged or closed PR won't change, so it is never looked up again, even with skipCache.
      if (cached && (isSettled(cached.data) || (!skipCache && cached.expiresAt > now))) {
        result.set(ref.url, cached.data);
      } else {
        stale.push(ref);
      }
    }
    for (let i = 0; i < stale.length; i += BATCH_SIZE) {
      for (const summary of await this.fetchBatch(stale.slice(i, i + BATCH_SIZE))) {
        result.set(summary.url, summary);
      }
    }
    return result;
  }

  private async findGhPath(): Promise<string> {
    // Return cached path if we've already searched
    if (this.ghPath !== undefined) {
      if (this.ghPath === null) {
        throw new Error("GitHub CLI (gh) not found. Install from https://cli.github.com");
      }
      return this.ghPath;
    }

    // Common paths to search on macOS, Linux, and Windows
    const candidates = [
      "gh", // Try PATH first
      "/usr/local/bin/gh", // Homebrew on Intel macOS
      "/opt/homebrew/bin/gh", // Homebrew on Apple Silicon
      "/usr/bin/gh", // System
      "C:\\Program Files\\GitHub CLI\\gh.exe", // Windows
      "C:\\Program Files (x86)\\GitHub CLI\\gh.exe" // Windows 32-bit
    ];

    for (const candidate of candidates) {
      try {
        // Try to stat the file (works for absolute paths)
        if (candidate.includes("/") || candidate.includes("\\")) {
          if (fs.existsSync(candidate)) {
            this.ghPath = candidate;
            return candidate;
          }
        } else {
          // For PATH entries, try to execute --version
          try {
            await execFileAsync(candidate, ["--version"], { timeout: 3000 });
            this.ghPath = candidate;
            return candidate;
          } catch {
            // Not in PATH, continue searching
          }
        }
      } catch {
        // Continue to next candidate
      }
    }

    // Mark as not found and throw
    this.ghPath = null;
    throw new Error("GitHub CLI (gh) not found. Install from https://cli.github.com");
  }

  public async checkGhAvailable(): Promise<{ ok: boolean; message?: string }> {
    try {
      const ghPath = await this.findGhPath();
      await execFileAsync(ghPath, ["--version"], { timeout: 7000 });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: this.errorMessage(error, "GitHub CLI (gh) not found. Install from https://cli.github.com") };
    }
  }

  private ttlMs(): number {
    const configured = vscode.workspace.getConfiguration("argus.prs").get<number>("cacheSeconds", 300);
    return Math.max(30, configured) * 1000;
  }

  private async fetchBatch(refs: PullRequestRef[]): Promise<PrSummary[]> {
    const query = `query {${refs
      .map((ref, i) => `pr${i}: repository(owner: ${JSON.stringify(ref.owner)}, name: ${JSON.stringify(ref.repo)}) { pullRequest(number: ${ref.number}) { ${PR_FIELDS} } }`)
      .join("\n")}}`;

    let response: GhBatchResponse = {};
    let callError: string | undefined;
    try {
      const ghPath = await this.findGhPath();
      const { stdout } = await execFileAsync(ghPath, ["api", "graphql", "-f", `query=${query}`], { timeout: 30000, maxBuffer: 20 * 1024 * 1024 });
      response = JSON.parse(stdout) as GhBatchResponse;
    } catch (error) {
      // gh exits non-zero when any one PR fails, but still prints the rest of the batch.
      const stdout = (error as { stdout?: string }).stdout;
      try {
        response = JSON.parse(stdout ?? "") as GhBatchResponse;
      } catch {
        callError = this.errorMessage(error, "Failed to sync PR. Ensure gh is installed and run `gh auth login`.");
      }
    }

    const now = Date.now();
    return refs.map((ref, i) => {
      const node = response.data?.[`pr${i}`]?.pullRequest;
      const syncedAt = new Date().toISOString();
      if (!node) {
        const message = callError ?? response.errors?.find((e) => e.path?.[0] === `pr${i}`)?.message ?? "PR not found.";
        const failed: PrSummary = { key: ref.key, url: ref.url, state: "unknown", isDraft: false, reviewers: [], checks: [], syncedAt, error: message };
        this.cache.set(ref.key, { data: failed, expiresAt: now + 15000 });
        return failed;
      }
      const data: PrSummary = {
        key: ref.key,
        title: node.title,
        url: ref.url,
        state: node.state ?? "unknown",
        isDraft: Boolean(node.isDraft),
        reviewDecision: node.reviewDecision ?? undefined,
        reviewers: this.dedupeReviewers(node.reviews?.nodes),
        checks: this.mapChecks(node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes),
        syncedAt
      };
      this.cache.set(ref.key, { data, expiresAt: now + this.ttlMs() });
      return data;
    });
  }

  private mapChecks(value: GhStatusCheck[] | undefined): PrCheck[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map((check) => ({
      name: check.context ?? check.name ?? "check",
      status: check.status ?? "UNKNOWN",
      conclusion: check.conclusion
    }));
  }

  private dedupeReviewers(reviews: GhReview[] | undefined): Array<{ login: string; state: string }> {
    if (!Array.isArray(reviews)) {
      return [];
    }

    const stateRank: Record<string, number> = {
      CHANGES_REQUESTED: 4,
      APPROVED: 3,
      COMMENTED: 2,
      DISMISSED: 1,
      PENDING: 0
    };

    const byLogin = new Map<string, { login: string; state: string }>();

    for (const review of reviews) {
      const login = review.author?.login?.trim();
      if (!login) {
        continue;
      }

      const nextState = (review.state ?? "COMMENTED").toUpperCase();
      const existing = byLogin.get(login);
      if (!existing) {
        byLogin.set(login, { login, state: nextState });
        continue;
      }

      const existingRank = stateRank[existing.state] ?? -1;
      const nextRank = stateRank[nextState] ?? -1;
      if (nextRank >= existingRank) {
        byLogin.set(login, { login, state: nextState });
      }
    }

    return [...byLogin.values()].sort((a, b) => a.login.localeCompare(b.login));
  }

  private errorMessage(error: unknown, fallback = "Unexpected error."): string {
    if (error instanceof Error) {
      return error.message;
    }

    return fallback;
  }
}

function isSettled(summary: PrSummary): boolean {
  return summary.state === "MERGED" || summary.state === "CLOSED";
}
