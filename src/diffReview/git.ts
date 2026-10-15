import { execFile } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type Scope = "all" | "committed" | "staged" | "unstaged";

export interface DiffLine {
  type: "ctx" | "add" | "del";
  old?: number;
  new?: number;
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: "added" | "deleted" | "modified" | "renamed";
  binary: boolean;
  additions: number;
  deletions: number;
  // Where the change lives: "committed", "staged", "unstaged", "untracked".
  tags: string[];
  hunks: DiffHunk[];
}

export interface DiffResult {
  folder: string;
  branch: string;
  base: string;
  mergeBase: string;
  scope: Scope | "pr";
  files: DiffFile[];
  pr?: { number: number; title: string; url: string; repo: string; headSha: string };
}

const MAX_UNTRACKED_BYTES = 512 * 1024;

async function git(folder: string, args: string[], okCodes: number[] = [0]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", folder, "-c", "core.quotepath=false", ...args], { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string; message: string };
    if (typeof e.code === "number" && okCodes.includes(e.code) && e.stdout !== undefined) {
      return e.stdout;
    }
    throw new Error((e.stderr || e.message).trim());
  }
}

async function refExists(folder: string, ref: string): Promise<boolean> {
  try {
    await git(folder, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

export async function detectBase(folder: string, configured: string): Promise<string> {
  if (configured) {
    return configured;
  }
  try {
    const head = (await git(folder, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).trim();
    if (head) {
      return head;
    }
  } catch {
    // origin/HEAD is not set in every clone; fall through to the usual names.
  }
  for (const ref of ["origin/main", "origin/master", "main", "master"]) {
    if (await refExists(folder, ref)) {
      return ref;
    }
  }
  throw new Error("Could not find a base branch. Set one in the Base field or argus.plugins.config.diff-review.baseRef.");
}

function diffArgs(scope: Scope, mergeBase: string): string[] {
  switch (scope) {
    case "all":
      return [mergeBase];
    case "committed":
      return [mergeBase, "HEAD"];
    case "staged":
      return ["--cached"];
    case "unstaged":
      return [];
  }
}

export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  for (const chunk of text.split(/^diff --git /m).slice(1)) {
    const lines = chunk.split("\n");
    const file: DiffFile = { path: "", status: "modified", binary: false, additions: 0, deletions: 0, tags: [], hunks: [] };
    let oldPath = "";
    let newPath = "";
    let i = 1;
    for (; i < lines.length && !lines[i].startsWith("@@"); i++) {
      const line = lines[i];
      if (line.startsWith("--- ")) oldPath = line.slice(4);
      else if (line.startsWith("+++ ")) newPath = line.slice(4);
      else if (line.startsWith("rename from ")) oldPath = "a/" + line.slice(12);
      else if (line.startsWith("rename to ")) newPath = "b/" + line.slice(10);
      else if (line.startsWith("new file mode")) file.status = "added";
      else if (line.startsWith("deleted file mode")) file.status = "deleted";
      else if (line.startsWith("Binary files")) file.binary = true;
    }
    if (!oldPath && !newPath) {
      // Binary or mode-only change: the paths are only in the "a/x b/x" header.
      const match = lines[0].match(/^a\/(.*) b\/(.*)$/);
      oldPath = match ? "a/" + match[1] : "";
      newPath = match ? "b/" + match[2] : "";
    }
    const strip = (p: string) => (p === "/dev/null" ? "" : p.replace(/^[ab]\//, ""));
    file.path = strip(newPath) || strip(oldPath);
    if (strip(oldPath) && strip(newPath) && strip(oldPath) !== strip(newPath)) {
      file.status = "renamed";
      file.oldPath = strip(oldPath);
    }

    let hunk: DiffHunk | undefined;
    let oldNo = 0;
    let newNo = 0;
    for (; i < lines.length; i++) {
      const line = lines[i];
      const header = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (header) {
        hunk = { header: line, lines: [] };
        file.hunks.push(hunk);
        oldNo = Number(header[1]);
        newNo = Number(header[2]);
      } else if (!hunk || line.startsWith("\\")) {
        continue;
      } else if (line.startsWith("+")) {
        hunk.lines.push({ type: "add", new: newNo++, text: line.slice(1) });
        file.additions++;
      } else if (line.startsWith("-")) {
        hunk.lines.push({ type: "del", old: oldNo++, text: line.slice(1) });
        file.deletions++;
      } else if (line.startsWith(" ")) {
        hunk.lines.push({ type: "ctx", old: oldNo++, new: newNo++, text: line.slice(1) });
      }
    }
    files.push(file);
  }
  return files;
}

async function untrackedFile(folder: string, rel: string): Promise<DiffFile> {
  const file: DiffFile = { path: rel, status: "added", binary: false, additions: 0, deletions: 0, tags: ["untracked"], hunks: [] };
  const full = path.join(folder, rel);
  const stat = await fs.stat(full);
  if (!stat.isFile() || stat.size > MAX_UNTRACKED_BYTES) {
    file.binary = true;
    return file;
  }
  const content = await fs.readFile(full);
  if (content.includes(0)) {
    file.binary = true;
    return file;
  }
  const lines = content.toString("utf8").replace(/\n$/, "").split("\n");
  file.hunks.push({ header: `@@ -0,0 +1,${lines.length} @@`, lines: lines.map((text, index) => ({ type: "add", new: index + 1, text })) });
  file.additions = lines.length;
  return file;
}

async function changeTags(folder: string, mergeBase: string): Promise<Map<string, Set<string>>> {
  const tags = new Map<string, Set<string>>();
  const add = (file: string, tag: string) => tags.set(file, (tags.get(file) ?? new Set()).add(tag));
  for (const file of (await git(folder, ["diff", "--name-only", "-z", mergeBase, "HEAD"])).split("\0").filter(Boolean)) {
    add(file, "committed");
  }
  // Porcelain -z: "XY path\0", with an extra "\0orig" after renames.
  const entries = (await git(folder, ["status", "--porcelain=v1", "-z", "--untracked-files=no"])).split("\0");
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    const [x, y, file] = [entry[0], entry[1], entry.slice(3)];
    if (x !== " ") add(file, "staged");
    if (y !== " ") add(file, "unstaged");
    if (x === "R" || x === "C") i++;
  }
  return tags;
}

export async function loadDiff(folder: string, scope: Scope, baseRef: string, contextLines: number): Promise<DiffResult> {
  const base = await detectBase(folder, baseRef);
  const mergeBase = (await git(folder, ["merge-base", "HEAD", base])).trim();
  const branch = (await git(folder, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  const raw = await git(folder, [
    "diff",
    "--no-color",
    "--no-ext-diff",
    "-M",
    `-U${contextLines}`,
    "--src-prefix=a/",
    "--dst-prefix=b/",
    ...diffArgs(scope, mergeBase)
  ]);
  const files = parseDiff(raw);

  if (scope === "all" || scope === "unstaged") {
    const untracked = (await git(folder, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
    files.push(...(await Promise.all(untracked.map((rel) => untrackedFile(folder, rel)))));
  }

  const tags = await changeTags(folder, mergeBase);
  for (const file of files) {
    if (file.tags.length === 0) {
      file.tags = [...(tags.get(file.path) ?? [])];
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { folder, branch, base, mergeBase, scope, files };
}

// The new side of the diff for a scope: HEAD for committed, the index for staged, else the working tree.
export async function fileLines(folder: string, scope: Scope, rel: string): Promise<string[]> {
  const text =
    scope === "committed" || scope === "staged"
      ? await git(folder, ["show", `${scope === "committed" ? "HEAD" : ""}:${rel}`])
      : await fs.readFile(path.join(folder, rel), "utf8");
  return text.replace(/\n$/, "").split("\n");
}
