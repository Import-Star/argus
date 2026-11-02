import * as path from "path";
import type { SlashItem } from "./protocol";

interface LocalCommand extends SlashItem {
  aliases?: readonly string[];
  // With arguments the command goes to Claude as usual; only the bare command is Argus's.
  bareOnly?: boolean;
}

// Slash commands the Claude Code CLI only offers in its own terminal UI, or only as text in an SDK session.
// Argus runs these itself instead of sending them to Claude.
export const LOCAL_COMMANDS = [
  { name: "remote-control", aliases: ["rc"], description: "Continue this chat from claude.ai or the Claude app (on, off, or toggle)", argumentHint: "[on|off]" },
  { name: "chrome", description: "Let Claude control your browser through Claude in Chrome (on, off, toggle, or pick the browser)", argumentHint: "[on|off|browser]" },
  { name: "add-dir", description: "Give Claude access to another folder in this chat", argumentHint: "<folder>" },
  { name: "memory", description: "Open a CLAUDE.md memory file", argumentHint: "" },
  { name: "agents", description: "Open or create a subagent definition", argumentHint: "" },
  { name: "resume", description: "Open another session from the board", argumentHint: "" },
  { name: "mcp", description: "See and manage MCP servers", argumentHint: "", bareOnly: true },
  { name: "permissions", description: "See and edit allow, ask and deny rules", argumentHint: "" },
  { name: "hooks", description: "See the hooks set for tool events", argumentHint: "" },
  { name: "context", description: "See what is using the context window", argumentHint: "", bareOnly: true },
  { name: "usage", description: "See plan usage and what is contributing to it", argumentHint: "", bareOnly: true },
  { name: "config", description: "Change Claude Code settings", argumentHint: "[key=value]", bareOnly: true },
  { name: "skills", description: "See the skills loaded in this chat and what they cost", argumentHint: "" },
  { name: "loops", description: "See, create and delete loops in this chat", argumentHint: "" },
  { name: "daemon", description: "See and manage the Claude Code background service", argumentHint: "" },
  { name: "model", description: "Pick the model for this chat", argumentHint: "[model]", bareOnly: true },
  { name: "effort", description: "Pick the effort level", argumentHint: "[level]", bareOnly: true },
  { name: "output-style", description: "Pick an output style", argumentHint: "[style]", bareOnly: true },
  { name: "advisor", description: "Pick the model Claude consults at key moments", argumentHint: "[model|off]", bareOnly: true },
  { name: "autocompact", description: "Pick how full the context gets before auto-summarising", argumentHint: "[window]", bareOnly: true },
  { name: "color", description: "Pick this chat's colour", argumentHint: "[color]", bareOnly: true },
  { name: "export", description: "Save this conversation to a file or the clipboard", argumentHint: "[file]" },
  { name: "copy", description: "Copy Claude's last response (or the Nth-latest)", argumentHint: "[N]" },
  { name: "branch", aliases: ["fork"], description: "Copy this conversation into a new chat from here", argumentHint: "" },
  { name: "plan", description: "Switch to plan mode, or open the plan pane", argumentHint: "" },
  { name: "login", description: "Sign in to Claude Code in a terminal", argumentHint: "" },
  { name: "logout", description: "Sign out of Claude Code in a terminal", argumentHint: "" },
  { name: "plugin", description: "Manage Claude Code plugins in a terminal", argumentHint: "" },
  { name: "feedback", aliases: ["bug"], description: "Send feedback to Anthropic in a terminal", argumentHint: "" },
  { name: "privacy-settings", description: "View and update privacy settings in a terminal", argumentHint: "" },
  { name: "install-github-app", description: "Set up Claude GitHub Actions in a terminal", argumentHint: "" },
  { name: "install-slack-app", description: "Install the Claude Slack app in a terminal", argumentHint: "" },
  { name: "web-setup", description: "Set up cloud sessions with GitHub in a terminal", argumentHint: "" },
  { name: "remote-env", description: "Choose the default cloud agent environment in a terminal", argumentHint: "" },
  { name: "teleport", description: "Send this work to the cloud, or resume a cloud session, in a terminal", argumentHint: "" },
  { name: "ultraplan", description: "Draft a plan in a cloud session, in a terminal", argumentHint: "" },
  { name: "ultrareview", description: "Find and verify bugs in your branch with a cloud session, in a terminal", argumentHint: "" },
  { name: "autofix-pr", description: "Monitor and autofix a PR, in a terminal", argumentHint: "" }
] as const satisfies readonly LocalCommand[];

export type LocalCommandName = (typeof LOCAL_COMMANDS)[number]["name"];

export const PANEL_COMMANDS = ["mcp", "permissions", "hooks", "context", "usage", "config", "skills", "loops", "daemon"] as const satisfies readonly LocalCommandName[];
export const PICKER_COMMANDS = ["model", "effort", "output-style", "advisor", "autocompact", "color"] as const satisfies readonly LocalCommandName[];
export const CLI_COMMANDS = ["export", "copy", "branch", "plan"] as const satisfies readonly LocalCommandName[];
// These need the CLI's interactive screens, so Argus runs `claude /<command>` in a VS Code terminal.
export const TERMINAL_COMMANDS = ["login", "logout", "plugin", "feedback", "privacy-settings", "install-github-app", "install-slack-app", "web-setup", "remote-env", "teleport", "ultraplan", "ultrareview", "autofix-pr"] as const satisfies readonly LocalCommandName[];

export type PanelKind = (typeof PANEL_COMMANDS)[number];
export type PickerName = (typeof PICKER_COMMANDS)[number];
export type CliCommandName = (typeof CLI_COMMANDS)[number];
export type TerminalCommandName = (typeof TERMINAL_COMMANDS)[number];

export const isOneOf = <T extends string>(list: readonly T[], name: string): name is T => (list as readonly string[]).includes(name);

export function parseLocalCommand(text: string): { name: LocalCommandName; args: string } | undefined {
  const match = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) {
    return undefined;
  }
  const typed = match[1].toLowerCase();
  const args = (match[2] ?? "").trim();
  const command: LocalCommand | undefined = LOCAL_COMMANDS.find((entry: LocalCommand) => entry.name === typed || entry.aliases?.includes(typed));
  return command && !(command.bareOnly && args) ? { name: command.name as LocalCommandName, args } : undefined;
}

// Adds the local commands to the SDK's list; a local one replaces an SDK command of the same name, since Argus handles it.
export function withLocalCommands(commands: SlashItem[]): SlashItem[] {
  const local = new Set<string>(LOCAL_COMMANDS.map((command) => command.name));
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
