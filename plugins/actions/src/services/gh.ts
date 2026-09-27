import { execFile } from "child_process";
import * as fs from "fs";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Absolute install paths to fall back to when `gh` is not on PATH.
const CANDIDATES = [
  "/opt/homebrew/bin/gh",
  "/usr/local/bin/gh",
  "/usr/bin/gh",
  "C:\\Program Files\\GitHub CLI\\gh.exe",
  "C:\\Program Files (x86)\\GitHub CLI\\gh.exe"
];

let resolved: string | undefined;

async function onPath(): Promise<boolean> {
  try {
    await execFileAsync("gh", ["--version"], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export async function ghPath(): Promise<string> {
  if (resolved) {
    return resolved;
  }
  if (await onPath()) {
    resolved = "gh";
    return resolved;
  }
  const found = CANDIDATES.find((candidate) => fs.existsSync(candidate));
  resolved = found ?? "gh";
  return resolved;
}

export function gh(args: string[], input?: string, timeout = 20000): Promise<string> {
  return new Promise((resolve, reject) => {
    void ghPath().then((command) => {
      const child = execFile(command, args, { timeout, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout);
      });
      if (input !== undefined) {
        child.stdin?.end(input);
      }
    });
  });
}

export async function ghJson<T>(path: string): Promise<T> {
  return JSON.parse(await gh(["api", path])) as T;
}

export async function ghPost(path: string, body: unknown): Promise<void> {
  await gh(["api", "--method", "POST", path, "--input", "-"], JSON.stringify(body ?? {}));
}

export async function checkGhAvailable(): Promise<{ ok: boolean; message?: string }> {
  try {
    const command = await ghPath();
    await execFileAsync(command, ["--version"], { timeout: 7000 });
    return { ok: true };
  } catch {
    return { ok: false, message: "GitHub CLI (gh) not found. Install from https://cli.github.com" };
  }
}
