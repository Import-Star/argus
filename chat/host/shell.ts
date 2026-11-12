import { spawn, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ShellRun } from "../../src/chat/protocol";
import { shellMessage } from "../../src/chat/conversationText";

const MAX_KEPT = 1_000_000;
const EMIT_EVERY_MS = 100;

interface Run extends ShellRun {
  stdout: string;
  stderr: string;
  child?: ChildProcess;
}

export interface ShellBackend {
  cwd: string;
  // Whether Claude should reply as soon as a command finishes: respondToBashCommands, true unless set false.
  respond(): boolean;
  deliver(text: string): void;
  changed(runs: ShellRun[]): void;
}

const keep = (text: string) => (text.length > MAX_KEPT ? text.slice(-MAX_KEPT) : text);

export class ShellRunner {
  private runs: Run[] = [];
  private timer?: NodeJS.Timeout;

  constructor(private readonly backend: ShellBackend) {}

  public items(): ShellRun[] {
    return this.runs.map(({ id, command, output, status, exitCode }) => ({ id, command, output, status, exitCode }));
  }

  public run(command: string): void {
    // Its own process group on Unix, so Stop also ends what the command started, e.g. the tests under `npm test`.
    const child = spawn(command, { cwd: this.backend.cwd, shell: process.env.SHELL || true, detached: process.platform !== "win32", env: process.env });
    const run: Run = { id: randomUUID(), command, output: "", status: "running", stdout: "", stderr: "", child };
    this.runs.push(run);
    child.stdout?.on("data", (chunk: Buffer) => this.append(run, "stdout", chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => this.append(run, "stderr", chunk.toString()));
    child.on("error", (error) => this.append(run, "stderr", `${error.message}\n`));
    child.on("close", (code, signal) => this.finish(run, code ?? (signal ? 130 : 1)));
    this.emit();
  }

  public act(id: string, action: "stop" | "background"): void {
    const run = this.runs.find((entry) => entry.id === id);
    if (action === "background" && run?.status === "running") {
      run.status = "background";
      this.emit();
    } else if (action === "stop" && run?.child) {
      kill(run.child);
    }
  }

  // Held output rides along with the next message the user sends.
  public takeHeld(): string {
    const held = this.runs.filter((run) => run.status === "held");
    this.runs = this.runs.filter((run) => run.status !== "held");
    if (held.length) {
      this.emit();
    }
    return held.map((run) => shellMessage(run.command, run.stdout, run.stderr)).join("\n");
  }

  public dispose(): void {
    clearTimeout(this.timer);
    this.runs.forEach((run) => run.child && kill(run.child));
  }

  private append(run: Run, stream: "stdout" | "stderr", text: string): void {
    run[stream] = keep(run[stream] + text);
    run.output = keep(run.output + text);
    this.timer ??= setTimeout(() => this.emit(), EMIT_EVERY_MS);
  }

  private finish(run: Run, exitCode: number): void {
    run.child = undefined;
    run.exitCode = exitCode;
    if (exitCode !== 0) {
      run.stderr += `\nExit code ${exitCode}`;
    }
    if (this.backend.respond()) {
      this.runs = this.runs.filter((entry) => entry !== run);
      this.emit();
      this.backend.deliver(shellMessage(run.command, run.stdout, run.stderr));
    } else {
      run.status = "held";
      this.emit();
    }
  }

  private emit(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.backend.changed(this.items());
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group already exited.
  }
}

// The shell dies first so it can't run the rest of a `a; b` list; the commands it started get time to clean up.
function kill(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) {
    return;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"]);
    return;
  }
  child.kill("SIGKILL");
  signalGroup(pid, "SIGTERM");
  setTimeout(() => signalGroup(pid, "SIGKILL"), 2000).unref();
}

// Files and folders that complete the last path token, written the way the user started it.
export async function pathSuggestions(cwd: string, token: string): Promise<string[]> {
  const head = token.slice(0, token.lastIndexOf("/") + 1);
  const prefix = token.slice(head.length);
  const dir = head.startsWith("~/") ? path.join(os.homedir(), head.slice(2)) : path.resolve(cwd, head || ".");
  const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.name.startsWith(prefix) && (prefix.startsWith(".") || !entry.name.startsWith(".")))
    .map((entry) => `${head}${entry.name}${entry.isDirectory() ? "/" : ""}`)
    .sort()
    .slice(0, 50);
}
