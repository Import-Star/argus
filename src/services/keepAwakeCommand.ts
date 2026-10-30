// Pure helpers for Argus's keep-awake: no vscode import, so tests can load them.
import type { SessionColumn } from "../types";

export interface InhibitorCommand {
  command: string;
  args: string[];
  // Shown in the log and the status bar tooltip.
  label: string;
}

// Sessions in these columns have Claude doing work (or about to, on a schedule) that sleep would interrupt.
const BUSY: ReadonlySet<SessionColumn> = new Set<SessionColumn>(["working", "scheduled"]);

export function agentsBusy(columns: Iterable<SessionColumn>): boolean {
  for (const column of columns) {
    if (BUSY.has(column)) {
      return true;
    }
  }
  return false;
}

// The process to run while the machine must stay awake. Each one holds its lock only while it runs, and exits
// by itself once `parentPid` (the extension host) is gone, so a crash never leaves the machine stuck awake.
export function inhibitorCommand(platform: NodeJS.Platform, parentPid: number, keepScreenOn: boolean): InhibitorCommand | undefined {
  const pid = Math.trunc(parentPid);
  if (platform === "win32") {
    // ES_CONTINUOUS | ES_SYSTEM_REQUIRED, plus ES_DISPLAY_REQUIRED. On Modern Standby laptops the system request
    // alone does not stop standby once the screen times out, so the screen flag is what really keeps it awake.
    const flags = (0x80000000 | 0x1 | (keepScreenOn ? 0x2 : 0)) >>> 0;
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "Add-Type -Namespace Argus -Name Power -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint esFlags);'",
      `[void][Argus.Power]::SetThreadExecutionState([uint32]${flags})`,
      `while (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 15 }`
    ].join("; ");
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      label: keepScreenOn ? "Windows power request (system and screen)" : "Windows power request (system)"
    };
  }
  if (platform === "darwin") {
    return { command: "caffeinate", args: [keepScreenOn ? "-dim" : "-im", "-w", String(pid)], label: "caffeinate" };
  }
  if (platform === "linux" || platform === "freebsd" || platform === "openbsd") {
    return {
      command: "systemd-inhibit",
      args: [
        `--what=${keepScreenOn ? "idle:sleep" : "sleep"}`,
        "--who=Argus",
        "--why=Claude agents are running",
        "--mode=block",
        "sh",
        "-c",
        `while kill -0 ${pid} 2>/dev/null; do sleep 15; done`
      ],
      label: "systemd-inhibit"
    };
  }
  return undefined;
}
