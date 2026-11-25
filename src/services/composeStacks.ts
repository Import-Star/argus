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

// Compose projects with containers on this machine, read from the labels Compose puts on each container.
// Empty when Docker isn't installed or isn't running.
export async function composeProjects(): Promise<ComposeProject[]> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["ps", "-a", "--filter", "label=com.docker.compose.project", "--format", '{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.project.working_dir"}}\t{{.State}}'],
      { timeout: 10_000 }
    );
    const projects = new Map<string, ComposeProject>();
    for (const [name, dir, state] of stdout.split("\n").filter(Boolean).map((line) => line.split("\t"))) {
      const running = state === "running" || Boolean(projects.get(name)?.running);
      projects.set(name, { name, dir: dir ?? "", running });
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
    (record.composeStacks ?? []).some((stack) => (stack.project ? stack.project === project.name : path.resolve(stack.dir) === path.resolve(project.dir))) ||
    (record.worktrees ?? []).some((folder) => inside(project.dir, folder))
  );
}

export async function removeComposeProject(name: string): Promise<void> {
  await execFileAsync("docker", ["compose", "-p", name, "down", "--volumes", "--remove-orphans"], { timeout: 120_000 });
}
