import * as path from "path";
import type { SlashItem } from "./protocol";

// Slash commands the Claude Code CLI only offers in its own terminal UI, so an SDK session never lists them.
// Argus runs these itself instead of sending them to Claude.
export const LOCAL_COMMANDS: (SlashItem & { aliases?: string[] })[] = [
  { name: "remote-control", aliases: ["rc"], description: "Continue this chat from claude.ai or the Claude app (on, off, or toggle)", argumentHint: "[on|off]" },
  { name: "chrome", description: "Let Claude control your browser through Claude in Chrome (on, off, toggle, or pick the browser)", argumentHint: "[on|off|browser]" },
  { name: "add-dir", description: "Give Claude access to another folder in this chat", argumentHint: "<folder>" },
  { name: "permissions", description: "Edit allow/deny rules in a Claude Code settings file", argumentHint: "" },
  { name: "hooks", description: "Edit hooks in a Claude Code settings file", argumentHint: "" },
  { name: "memory", description: "Open a CLAUDE.md memory file", argumentHint: "" },
  { name: "agents", description: "Open or create a subagent definition", argumentHint: "" },
  { name: "resume", description: "Open another session from the board", argumentHint: "" },
  { name: "login", description: "Sign in to Claude Code in a terminal", argumentHint: "" },
  { name: "logout", description: "Sign out of Claude Code in a terminal", argumentHint: "" },
  { name: "plugin", description: "Manage Claude Code plugins in a terminal", argumentHint: "" }
];

export type LocalCommandName = "remote-control" | "chrome" | "add-dir" | "permissions" | "hooks" | "memory" | "agents" | "resume" | "login" | "logout" | "plugin";

export function parseLocalCommand(text: string): { name: LocalCommandName; args: string } | undefined {
  const match = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) {
    return undefined;
  }
  const typed = match[1].toLowerCase();
  const command = LOCAL_COMMANDS.find((entry) => entry.name === typed || entry.aliases?.includes(typed));
  return command ? { name: command.name as LocalCommandName, args: (match[2] ?? "").trim() } : undefined;
}

// Adds the local commands to the SDK's list; a local one replaces an SDK command of the same name, since Argus handles it.
export function withLocalCommands(commands: SlashItem[]): SlashItem[] {
  const local = new Set(LOCAL_COMMANDS.map((command) => command.name));
  return [...commands.filter((command) => !local.has(command.name)), ...LOCAL_COMMANDS.map(({ name, description, argumentHint }) => ({ name, description, argumentHint }))];
}

// "on"/"off" set the state; nothing toggles it. Anything else is not understood.
export function parseToggle(args: string, current: boolean): boolean | undefined {
  const word = args.trim().toLowerCase();
  if (!word) {
    return !current;
  }
  if (["on", "enable", "true", "yes"].includes(word)) {
    return true;
  }
  if (["off", "disable", "false", "no"].includes(word)) {
    return false;
  }
  return undefined;
}

// CLI flags for Claude in Chrome. Unset leaves the CLI's own default, which for an SDK session is off.
export function chromeArgs(chrome: boolean | undefined): Record<string, null> {
  return chrome === undefined ? {} : chrome ? { chrome: null } : { "no-chrome": null };
}

export interface FileChoice {
  label: string;
  description: string;
  file: string;
}

// The settings files Claude Code reads for permissions and hooks, user first.
export function settingsFiles(cwd: string, home: string): FileChoice[] {
  return [
    { label: "User settings", description: "All your projects", file: path.join(home, ".claude", "settings.json") },
    { label: "Project settings", description: "Checked in, shared with the team", file: path.join(cwd, ".claude", "settings.json") },
    { label: "Local project settings", description: "This project, just you (gitignored)", file: path.join(cwd, ".claude", "settings.local.json") }
  ];
}

export function memoryFiles(cwd: string, home: string): FileChoice[] {
  return [
    { label: "User memory", description: "All your projects", file: path.join(home, ".claude", "CLAUDE.md") },
    { label: "Project memory", description: "Checked in, shared with the team", file: path.join(cwd, "CLAUDE.md") },
    { label: "Local project memory", description: "This project, just you", file: path.join(cwd, "CLAUDE.local.md") }
  ];
}

export function agentFolders(cwd: string, home: string): FileChoice[] {
  return [
    { label: "Project agent", description: "Checked in, shared with the team", file: path.join(cwd, ".claude", "agents") },
    { label: "User agent", description: "All your projects", file: path.join(home, ".claude", "agents") }
  ];
}

// Agent names become file names and the `name:` field: lowercase words joined by hyphens.
export function agentSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function agentTemplate(slug: string): string {
  return `---\nname: ${slug}\ndescription: TODO: when Claude should use this agent\n---\n\nTODO: the agent's instructions.\n`;
}
