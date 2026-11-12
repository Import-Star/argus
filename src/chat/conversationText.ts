const USER_NOISE = /^<(local-command-caveat|local-command-stdout|task-notification|system-reminder|command-message)\b/;

// The CLI's own tags for a `!` command, so Claude and resumed CLI sessions read Argus's runs the same way.
const BLOCK = /<bash-input>([\s\S]*?)<\/bash-input>|<bash-stdout>([\s\S]*?)<\/bash-stdout>|<bash-stderr>([\s\S]*?)<\/bash-stderr>/g;

export const MAX_SHELL_OUTPUT = 30000;

export interface ShellBlock {
  // Unset when the output arrived in its own message, as the CLI writes it after the command's message.
  command?: string;
  stdout: string;
  stderr: string;
}

// The command in a `!` prompt; undefined for any other prompt or a bare `!`.
export function shellCommand(text: string): string | undefined {
  return /^!\s*([\s\S]*\S)/.exec(text.trim())?.[1];
}

export function splitShell(text: string): { blocks: ShellBlock[]; rest: string } {
  const blocks: ShellBlock[] = [];
  const rest = text.replace(BLOCK, (_match, command?: string, stdout?: string, stderr?: string) => {
    if (command !== undefined) {
      blocks.push({ command: command.trim(), stdout: "", stderr: "" });
      return "";
    }
    if (blocks.length === 0) {
      blocks.push({ stdout: "", stderr: "" });
    }
    const last = blocks[blocks.length - 1];
    if (stdout !== undefined) {
      last.stdout = stdout;
    } else {
      last.stderr = stderr ?? "";
    }
    return "";
  });
  return { blocks, rest: rest.trim() };
}

// Keeps the end, where a failing command usually says why.
function tail(text: string): string {
  const cut = text.length - MAX_SHELL_OUTPUT;
  return cut > 0 ? `[output truncated: ${cut} more characters not shown]\n${text.slice(cut)}` : text;
}

export function shellMessage(command: string, stdout: string, stderr: string): string {
  return `<bash-input>${command}</bash-input>\n<bash-stdout>${tail(stdout)}</bash-stdout><bash-stderr>${tail(stderr)}</bash-stderr>`;
}

export function cleanUserText(raw: string): string {
  const { blocks, rest } = splitShell(raw);
  if (blocks.length) {
    return [...blocks.filter((block) => block.command !== undefined).map((block) => `! ${block.command}`), cleanUserText(rest)].filter(Boolean).join("\n");
  }
  const text = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  const command = /<command-name>([\s\S]*?)<\/command-name>(?:[\s\S]*?<command-args>([\s\S]*?)<\/command-args>)?/.exec(text);
  // Argus sends /rename itself to keep the session name in step with the title.
  if (command?.[1].trim() === "/rename") {
    return "";
  }
  if (command) {
    return `${command[1].trim()} ${(command[2] ?? "").trim()}`.trim();
  }
  return USER_NOISE.test(text) ? "" : text;
}

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

interface Entry {
  type: string;
  parent_tool_use_id?: string | null;
  isSynthetic?: boolean;
  isMeta?: boolean;
  origin?: { kind?: string };
  message?: { content?: unknown };
}

function textOf(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  const parts = Array.isArray(content) ? (content as { type?: string; text?: unknown }[]) : [];
  return parts.filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
}

// Typed prompts and Claude's text replies, in order. Tool calls, thinking and injected context are left out.
export function conversationTurns(messages: readonly unknown[]): Turn[] {
  const turns: Turn[] = [];
  for (const entry of messages as Entry[]) {
    if (entry.parent_tool_use_id || (entry.type !== "user" && entry.type !== "assistant")) {
      continue;
    }
    if (entry.type === "user" && (entry.isSynthetic || entry.isMeta || (entry.origin && entry.origin.kind !== "human"))) {
      continue;
    }
    const raw = textOf(entry.message?.content);
    const text = entry.type === "user" ? cleanUserText(raw) : raw.trim();
    if (text && !raw.startsWith("[Request interrupted")) {
      turns.push({ role: entry.type, text });
    }
  }
  // A slash command the CLI answered itself has no reply here, so leave it out.
  return turns.filter((turn, index) => !(turn.role === "user" && turn.text.startsWith("/") && turns[index + 1]?.role !== "assistant"));
}

// n = 1 is the latest reply.
export function nthLatestReply(turns: readonly Turn[], n: number): string | undefined {
  return turns.filter((turn) => turn.role === "assistant").reverse()[n - 1]?.text;
}

export function conversationMarkdown(title: string, turns: readonly Turn[]): string {
  const sections = [`# ${title}`];
  turns.forEach((turn, index) => {
    const heading = turn.role === "user" ? "## You" : "## Claude";
    sections.push(turns[index - 1]?.role === turn.role && turn.role === "assistant" ? turn.text : `${heading}\n\n${turn.text}`);
  });
  return `${sections.join("\n\n")}\n`;
}

// "/copy 2" is the second-latest reply; anything else is not understood.
export function parseReplyIndex(args: string): number | undefined {
  if (!args) {
    return 1;
  }
  return /^[1-9]\d*$/.test(args) ? Number(args) : undefined;
}
