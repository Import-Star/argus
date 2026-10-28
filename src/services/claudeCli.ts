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
  if (configured) {
    return configured;
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
