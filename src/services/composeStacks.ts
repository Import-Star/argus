import { execFile } from "child_process";
import * as path from "path";
import { promisify } from "util";
import type { SessionRecord } from "../types";

const execFileAsync = promisify(execFile);

export interface ComposeProject {
  name: string;
  dir: string;
  running: boolean;
}

// `docker` on PATH, or on Windows the Docker Engine inside a WSL distro (argus.docker.wslDistro), run through wsl.exe.
function docker(args: string[], wslDistro: string | undefined, timeout: number): Promise<{ stdout: string }> {
  return process.platform === "win32" && wslDistro
    ? execFileAsync("wsl.exe", ["-d", wslDistro, "--", "docker", ...args], { timeout, windowsHide: true })
    : execFileAsync("docker", args, { timeout, windowsHide: true });
}

// A folder as WSL reports it, `/mnt/c/Users/...`, as the Windows path `C:\Users\...`. Folders inside the distro
// itself have no Windows path this needs and stay as they are.
export function fromWsl(dir: string): string {
  const match = /^\/mnt\/([a-zA-Z])(\/.*)?$/.exec(dir);
  return match ? path.win32.join(`${match[1].toUpperCase()}:\\`, match[2] ?? "") : dir;
}

// Compose projects with containers on this machine, read from the labels Compose puts on each container.
// Empty when Docker isn't installed or isn't running.
export async function composeProjects(wslDistro?: string): Promise<ComposeProject[]> {
  try {
    const { stdout } = await docker(
      ["ps", "-a", "--filter", "label=com.docker.compose.project", "--format", '{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.project.working_dir"}}\t{{.State}}'],
      wslDistro,
      10_000
    );
    const projects = new Map<string, ComposeProject>();
    for (const [name, dir, state] of stdout.split(/\r?\n/).filter(Boolean).map((line) => line.split("\t"))) {
      const running = state === "running" || Boolean(projects.get(name)?.running);
      projects.set(name, { name, dir: process.platform === "win32" && wslDistro ? fromWsl(dir ?? "") : (dir ?? ""), running });
    }
    return [...projects.values()].sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function inside(dir: string, folder: string): boolean {
  const relative = path.relative(folder, dir);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

// A session owns a project it started, or one running from inside one of its worktrees.
export function ownsProject(record: SessionRecord, project: ComposeProject): boolean {
  return (
    (record.composeStacks ?? []).some((stack) => (stack.project ? stack.project === project.name : path.relative(stack.dir, project.dir) === "")) ||
    (record.worktrees ?? []).some((folder) => inside(project.dir, folder))
  );
}

export async function removeComposeProject(name: string, wslDistro?: string): Promise<void> {
  await docker(["compose", "-p", name, "down", "--volumes", "--remove-orphans"], wslDistro, 120_000);
}
