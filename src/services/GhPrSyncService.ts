import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as vscode from "vscode";
import { parsePullRequestLinks } from "./PrLinkParser";
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

interface GhPrView {
  title?: string;
  url?: string;
  state?: string;
  isDraft?: boolean;
  reviewDecision?: string;
  reviews?: GhReview[];
  statusCheckRollup?: GhStatusCheck[];
}

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
    const refs = urls.flatMap((url) => parsePullRequestLinks(url));
    let current = 0;
    const workers = new Array(Math.min(this.maxConcurrent(), refs.length)).fill(0).map(async () => {
      while (current < refs.length) {
        const ref = refs[current];
        current += 1;
        if (skipCache) {
          this.cache.delete(ref.key);
        }
        result.set(ref.url, await this.getPrSummary(ref.owner, ref.repo, ref.number, ref.url));
      }
    });
    await Promise.all(workers);
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

  private maxConcurrent(): number {
    const configured = vscode.workspace.getConfiguration("argus.prs").get<number>("maxConcurrent", 5);
    return Math.max(1, Math.min(20, configured));
  }

  private ttlMs(): number {
    const configured = vscode.workspace.getConfiguration("argus.prs").get<number>("cacheSeconds", 300);
    return Math.max(30, configured) * 1000;
  }

  private async getPrSummary(owner: string, repo: string, number: number, defaultUrl: string): Promise<PrSummary> {
    const key = `${owner}/${repo}#${number}`;
    const cached = this.cache.get(key);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    const ghPath = await this.findGhPath();
    const fields = [
      "title",
      "url",
      "state",
      "isDraft",
      "reviewDecision",
      "reviews",
      "statusCheckRollup"
    ].join(",");

    try {
      const { stdout } = await execFileAsync(
        ghPath,
        ["pr", "view", String(number), "--repo", `${owner}/${repo}`, "--json", fields],
        { timeout: 15000 }
      );

      const parsed = JSON.parse(stdout) as GhPrView;
      const data: PrSummary = {
        key,
        title: parsed.title,
        url: parsed.url ?? defaultUrl,
        state: parsed.state ?? "unknown",
        isDraft: Boolean(parsed.isDraft),
        reviewDecision: parsed.reviewDecision,
        reviewers: this.dedupeReviewers(parsed.reviews),
        checks: this.mapChecks(parsed.statusCheckRollup),
        syncedAt: new Date().toISOString()
      };

      this.cache.set(key, { data, expiresAt: now + this.ttlMs() });
      return data;
    } catch (error) {
      const message = this.errorMessage(
        error,
        "Failed to sync PR. Ensure gh is installed and run `gh auth login`."
      );
      const failed: PrSummary = {
        key,
        url: defaultUrl,
        state: "unknown",
        isDraft: false,
        reviewers: [],
        checks: [],
        syncedAt: new Date().toISOString(),
        error: message
      };
      this.cache.set(key, { data: failed, expiresAt: now + 15000 });
      return failed;
    }
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
