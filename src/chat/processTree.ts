import { execFile } from "child_process";

// Stops a process and everything it started. A plain kill leaves the children running: Claude Code processes and
// their background shells outlive the chat background process, most of all on Windows.

const TIMEOUT_MS = 15_000;

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

// Reads "pid ppid" lines, as `ps -A -o pid=,ppid=` and the Windows listing below print them.
export function parseProcessTable(output: string): { pid: number; ppid: number }[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]) }] : [];
  });
}

// Every process below root, parents before their children. Root itself isn't included.
export function descendants(table: { pid: number; ppid: number }[], root: number): number[] {
  const children = new Map<number, number[]>();
  for (const { pid, ppid } of table) {
    if (pid !== ppid) {
      children.set(ppid, [...(children.get(ppid) ?? []), pid]);
    }
  }
  const found: number[] = [];
  const seen = new Set([root]);
  const queue = [root];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()!) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        found.push(child);
        queue.push(child);
      }
    }
  }
  return found;
}

async function processTable(): Promise<{ pid: number; ppid: number }[]> {
  if (process.platform === "win32") {
    const script = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }';
    return parseProcessTable(await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]));
  }
  return parseProcessTable(await run("ps", ["-A", "-o", "pid=,ppid="]));
}

async function taskkillTree(pid: number): Promise<void> {
  try {
    await run("taskkill", ["/PID", String(pid), "/T", "/F"]);
  } catch (error) {
    // Exit code 128: the process had already exited.
    if ((error as { code?: unknown }).code !== 128) {
      throw error;
    }
  }
}

function signalKill(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

// Kills pid's descendants, and pid itself unless keepRoot is set (a process stopping its own children).
export async function killProcessTree(pid: number, { keepRoot = false } = {}): Promise<void> {
  if (process.platform === "win32") {
    if (!keepRoot) {
      // taskkill walks the tree while the root is still alive to link it.
      return taskkillTree(pid);
    }
    const table = await processTable();
    const direct = table.filter((row) => row.ppid === pid && row.pid !== pid).map((row) => row.pid);
    await Promise.all(direct.map(taskkillTree));
    return;
  }
  const below = descendants(await processTable(), pid);
  // Root first, so it can't start anything new while its children go.
  for (const target of keepRoot ? below : [pid, ...below]) {
    signalKill(target);
  }
}
