import { execFile } from "child_process";
import { existsSync } from "fs";
import { promisify } from "util";
import { DiffResult, parseDiff } from "./git";

const execFileAsync = promisify(execFile);

// VS Code launched from the Dock doesn't get the shell PATH, so Homebrew's gh isn't found by name.
const ghPath = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"].find((p) => existsSync(p)) ?? "gh";

async function gh(folder: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(ghPath, args, { cwd: folder, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const e = error as { stderr?: string; message: string };
    throw new Error((e.stderr || e.message).trim());
  }
}

// `pr` is a number (resolved against the folder's repo) or a PR URL.
export async function loadPrDiff(folder: string, pr: string): Promise<DiffResult> {
  const view = JSON.parse(await gh(folder, ["pr", "view", pr, "--json", "number,title,url,headRefName,baseRefName,headRefOid,baseRefOid"])) as {
    number: number;
    title: string;
    url: string;
    headRefName: string;
    baseRefName: string;
    headRefOid: string;
    baseRefOid: string;
  };
  const files = parseDiff(await gh(folder, ["pr", "diff", view.url, "--color", "never"]));
  files.sort((a, b) => a.path.localeCompare(b.path));
  const repo = new URL(view.url).pathname.split("/").slice(1, 3).join("/");
  return {
    folder,
    branch: view.headRefName,
    base: view.baseRefName,
    mergeBase: view.baseRefOid,
    scope: "pr",
    files,
    pr: { number: view.number, title: view.title, url: view.url, repo, headSha: view.headRefOid }
  };
}

// The PR head commit is reachable from the base repo, fork PRs included.
export async function prFileLines(folder: string, repo: string, sha: string, rel: string): Promise<string[]> {
  const encoded = rel.split("/").map(encodeURIComponent).join("/");
  const text = await gh(folder, ["api", "-H", "Accept: application/vnd.github.raw+json", `repos/${repo}/contents/${encoded}?ref=${sha}`]);
  return text.replace(/\n$/, "").split("\n");
}
