import { execFile } from "child_process";
import { existsSync } from "fs";
import { promisify } from "util";
import { DiffResult, git, parseDiff } from "./git";

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

const reviews = new Map<string, DiffResult>();

// The local clone of the PR's repo, or undefined when the folder is another repo.
async function originRepo(folder: string): Promise<string | undefined> {
  try {
    return /github\.com[:/](.+?)(?:\.git)?\/?$/.exec((await git(folder, ["remote", "get-url", "origin"])).trim())?.[1].toLowerCase();
  } catch {
    return undefined;
  }
}

// Fetching the PR into the local clone makes the diff and every file read local, instead of a GitHub call each.
function fetchPr(folder: string, number: number): Promise<void> {
  return git(folder, ["fetch", "--quiet", "--no-tags", "origin", `pull/${number}/head`]).then(() => undefined);
}

async function localDiff(folder: string, fetched: Promise<void>, number: number, baseRef: string, baseSha: string, headSha: string): Promise<string> {
  await fetched.catch(() => fetchPr(folder, number));
  await git(folder, ["cat-file", "-e", `${baseSha}^{commit}`]).catch(() => git(folder, ["fetch", "--quiet", "--no-tags", "origin", `refs/heads/${baseRef}`]));
  return git(folder, ["diff", "--no-color", "--no-ext-diff", "-M", "--src-prefix=a/", "--dst-prefix=b/", `${baseSha}...${headSha}`]);
}

// `pr` is a number (resolved against the folder's repo) or a PR URL. `reuse` returns the last load, for file clicks.
export async function loadPrDiff(folder: string, pr: string, reuse = false): Promise<DiffResult> {
  const key = `${folder}\n${pr}`;
  const cached = reviews.get(key);
  if (reuse && cached) {
    return cached;
  }
  // A PR URL already names the PR, so the fetch runs alongside `gh pr view`.
  const origin = await originRepo(folder);
  const fromUrl = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(pr);
  const early = fromUrl && fromUrl[1].toLowerCase() === origin ? fetchPr(folder, Number(fromUrl[2])) : undefined;
  early?.catch(() => undefined);
  const view = JSON.parse(await gh(folder, ["pr", "view", pr, "--json", "number,title,url,headRefName,baseRefName,headRefOid,baseRefOid"])) as {
    number: number;
    title: string;
    url: string;
    headRefName: string;
    baseRefName: string;
    headRefOid: string;
    baseRefOid: string;
  };
  const repo = new URL(view.url).pathname.split("/").slice(1, 3).join("/");
  const local = origin === repo.toLowerCase();
  const raw = local
    ? await localDiff(folder, early ?? fetchPr(folder, view.number), view.number, view.baseRefName, view.baseRefOid, view.headRefOid).catch(() => undefined)
    : undefined;
  const files = parseDiff(raw ?? (await gh(folder, ["pr", "diff", view.url, "--color", "never"])));
  files.sort((a, b) => a.path.localeCompare(b.path));
  const result: DiffResult = {
    folder,
    branch: view.headRefName,
    base: view.baseRefName,
    mergeBase: view.baseRefOid,
    scope: "pr",
    files,
    pr: { number: view.number, title: view.title, url: view.url, repo, headSha: view.headRefOid, local: raw !== undefined }
  };
  reviews.set(key, result);
  return result;
}

// The PR head commit is reachable from the base repo, fork PRs included.
export async function prFileLines(folder: string, pr: NonNullable<DiffResult["pr"]>, rel: string): Promise<string[]> {
  if (pr.local) {
    return (await git(folder, ["show", `${pr.headSha}:${rel}`])).replace(/\n$/, "").split("\n");
  }
  const encoded = rel.split("/").map(encodeURIComponent).join("/");
  const text = await gh(folder, ["api", "-H", "Accept: application/vnd.github.raw+json", `repos/${pr.repo}/contents/${encoded}?ref=${pr.headSha}`]);
  return text.replace(/\n$/, "").split("\n");
}
