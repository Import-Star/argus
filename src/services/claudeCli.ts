import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

function onPath(name: string, platform: NodeJS.Platform): string | undefined {
  try {
    return execFileSync(platform === "win32" ? "where" : "which", [name], { encoding: "utf8" }).split(/\r?\n/)[0].trim() || undefined;
  } catch {
    return undefined;
  }
}

// The `claude` Argus chat runs: the configured path, then PATH, then where Anthropic's native installer puts it.
export function findClaude(
  configured: string,
  platform: NodeJS.Platform = process.platform,
  lookup: (name: string, platform: NodeJS.Platform) => string | undefined = onPath,
  exists: (file: string) => boolean = fs.existsSync,
  home: string = os.homedir()
): string | undefined {
  // A configured path that's gone counts as not installed, so the user is offered the installer.
  if (configured) {
    return exists(configured) ? configured : undefined;
  }
  const name = platform === "win32" ? "claude.exe" : "claude";
  const found = lookup(name, platform);
  if (found) {
    return found;
  }
  const local = (platform === "win32" ? path.win32 : path.posix).join(home, ".local", "bin", name);
  return exists(local) ? local : undefined;
}

// Anthropic's native installer (https://code.claude.com/docs/en/setup), run in a shell that stays open afterwards so
// the user can read its output.
export function installerShell(platform: NodeJS.Platform = process.platform): { shellPath: string; shellArgs: string[]; command: string } {
  if (platform === "win32") {
    const command = "irm https://claude.ai/install.ps1 | iex";
    return { shellPath: "powershell.exe", shellArgs: ["-NoProfile", "-NoExit", "-Command", command], command };
  }
  const command = "curl -fsSL https://claude.ai/install.sh | bash";
  return { shellPath: "/bin/bash", shellArgs: ["-c", `${command}; exec "\${SHELL:-/bin/bash}" -l`], command };
}

// Where Anthropic's installer reads the current version of each update channel.
export function releaseUrl(channel: unknown): string {
  return `https://downloads.claude.ai/claude-code-releases/${channel === "stable" ? "stable" : "latest"}`;
}

// "2.1.314 (Claude Code)" -> "2.1.314"
export function parseVersion(text: string): string | undefined {
  return /\d+\.\d+\.\d+/.exec(text)?.[0];
}

export function isOlder(current: string, latest: string): boolean {
  const a = current.split(".").map(Number);
  const b = latest.split(".").map(Number);
  const i = a.findIndex((part, index) => part !== b[index]);
  return i !== -1 && a[i] < b[i];
}

// `claude update` updates through whatever installed it (native, npm, Homebrew), in a shell that stays open.
export function updaterShell(claude: string, platform: NodeJS.Platform = process.platform): { shellPath: string; shellArgs: string[] } {
  if (platform === "win32") {
    return { shellPath: "powershell.exe", shellArgs: ["-NoProfile", "-NoExit", "-Command", `& '${claude.replace(/'/g, "''")}' update`] };
  }
  return { shellPath: "/bin/bash", shellArgs: ["-c", `"$0" update; exec "\${SHELL:-/bin/bash}" -l`, claude] };
}
