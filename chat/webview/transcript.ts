import { REVIEW_PROMPT_START, type SDKMessage } from "../../src/chat/protocol";

export interface DiffLine {
  kind: "ctx" | "add" | "del";
  text: string;
}

export interface Lookup {
  id: string;
  name: string;
  label: string;
  done: boolean;
  error?: boolean;
}

export interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export type Item =
  | { kind: "user"; id: string; text: string; images: string[] }
  | { kind: "text"; id: string; text: string; streaming?: boolean }
  | { kind: "thinking"; id: string; text: string; streaming?: boolean }
  | { kind: "lookups"; id: string; calls: Lookup[]; summary: string; pending: boolean }
  | { kind: "edit"; id: string; tool: string; path: string; added: number; removed: number; lines: DiffLine[]; hidden: number; pending: boolean; error?: string }
  | { kind: "bash"; id: string; command: string; description?: string; output?: string; pending: boolean; error?: boolean }
  | { kind: "todos"; id: string; todos: Todo[]; done: number }
  | { kind: "agent"; id: string; toolUseId: string; subagentType: string; description: string; taskId?: string; pending: boolean; error?: string }
  | { kind: "workflow"; id: string; toolUseId: string; input: Record<string, unknown> }
  | { kind: "tool"; id: string; name: string; summary: string; pending: boolean; error?: string }
  | { kind: "note"; id: string; text: string; tone: "muted" | "error" };

type Block = { type: string; [key: string]: unknown };
type ToolResult = { text: string; isError: boolean };
type Input = Record<string, unknown>;
type Raw = SDKMessage & { [key: string]: any };

const MAX_DIFF_LINES = 10;
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const LOOKUP_TOOLS: Record<string, string> = {
  Read: "file",
  NotebookRead: "file",
  Grep: "search",
  Glob: "search",
  WebFetch: "page",
  WebSearch: "web",
  LS: "dir",
  ToolSearch: "tool",
  ListMcpResourcesTool: "resource",
  ReadMcpResourceTool: "resource",
  TaskList: "task",
  TaskGet: "task"
};
const LOOKUP_PHRASES: Record<string, [string, string, string]> = {
  file: ["Read", "file", "files"],
  search: ["searched", "pattern", "patterns"],
  page: ["fetched", "page", "pages"],
  web: ["ran", "web search", "web searches"],
  dir: ["listed", "directory", "directories"],
  tool: ["looked up", "tool", "tools"],
  resource: ["read", "resource", "resources"],
  task: ["checked", "task", "tasks"]
};
const ERROR_LABELS: Record<string, string> = {
  error_max_turns: "Stopped: reached the turn limit",
  error_max_budget_usd: "Stopped: reached the budget limit",
  error_max_structured_output_retries: "Stopped: structured output kept failing",
  error_during_execution: "Stopped: error during execution"
};

const str = (value: unknown): string => (typeof value === "string" ? value : "");

function blocks(content: unknown): Block[] {
  return Array.isArray(content) ? (content as Block[]) : [];
}

function resultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  return blocks(content)
    .filter((block) => block.type === "text")
    .map((block) => str(block.text))
    .join("\n");
}

export function displayPath(path: string, cwd?: string): string {
  if (cwd && path.startsWith(`${cwd}/`)) {
    return path.slice(cwd.length + 1);
  }
  return path;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function summarizeLookups(calls: Lookup[]): string {
  const counts = new Map<string, number>();
  for (const call of calls) {
    const category = LOOKUP_TOOLS[call.name] ?? "tool";
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const text = [...counts].map(([category, count]) => `${LOOKUP_PHRASES[category][0]} ${plural(count, LOOKUP_PHRASES[category][1], LOOKUP_PHRASES[category][2])}`).join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function lookupLabel(name: string, input: Input): string {
  const value = input.file_path ?? input.notebook_path ?? input.pattern ?? input.url ?? input.query ?? input.path ?? input.uri ?? input.server ?? input.taskId;
  return str(value) || name;
}

function splitLines(text: string): string[] {
  return text === "" ? [] : text.replace(/\n$/, "").split("\n");
}

// Trims the shared head/tail so only the lines that really changed count, keeping one line of context each side.
export function diffLines(oldText: string, newText: string): { lines: DiffLine[]; added: number; removed: number } {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) {
    head++;
  }
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) {
    tail++;
  }
  const removed = a.slice(head, a.length - tail);
  const added = b.slice(head, b.length - tail);
  const lines: DiffLine[] = [
    ...a.slice(Math.max(0, head - 1), head).map((text): DiffLine => ({ kind: "ctx", text })),
    ...removed.map((text): DiffLine => ({ kind: "del", text })),
    ...added.map((text): DiffLine => ({ kind: "add", text })),
    ...a.slice(a.length - tail, a.length - tail + 1).map((text): DiffLine => ({ kind: "ctx", text }))
  ];
  return { lines, added: added.length, removed: removed.length };
}

function editItem(id: string, tool: string, input: Input): Extract<Item, { kind: "edit" }> {
  const path = str(input.file_path) || str(input.notebook_path);
  const pairs: [string, string][] =
    tool === "MultiEdit"
      ? blocks(input.edits).map((edit) => [str(edit.old_string), str(edit.new_string)])
      : tool === "Write"
        ? [["", str(input.content)]]
        : tool === "NotebookEdit"
          ? [["", str(input.new_source)]]
          : [[str(input.old_string), str(input.new_string)]];
  const diffs = pairs.map(([oldText, newText]) => diffLines(oldText, newText));
  const lines = diffs.flatMap((diff) => diff.lines);
  return {
    kind: "edit",
    id,
    tool,
    path,
    added: diffs.reduce((sum, diff) => sum + diff.added, 0),
    removed: diffs.reduce((sum, diff) => sum + diff.removed, 0),
    lines: lines.slice(0, MAX_DIFF_LINES),
    hidden: Math.max(0, lines.length - MAX_DIFF_LINES),
    pending: true
  };
}

function toolSummary(input: Input): string {
  const value = input.description ?? input.file_path ?? input.command ?? input.pattern ?? input.query ?? input.url ?? input.prompt ?? input.path;
  const text = str(value).replace(/\s+/g, " ").trim();
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

function todosOf(input: Input): Todo[] {
  return blocks(input.todos).map((todo) => ({ content: str(todo.content), status: todo.status as Todo["status"] }));
}

function todoCard(id: string, todos: Todo[]): Extract<Item, { kind: "todos" }> {
  return { kind: "todos", id, todos, done: todos.filter((todo) => todo.status === "completed").length };
}

function applyTaskUpdate(tasks: { id?: string; todo: Todo }[], task: { id?: string; todo: Todo }, input: Input) {
  if (input.status === "deleted") {
    tasks.splice(tasks.indexOf(task), 1);
    return;
  }
  if (typeof input.subject === "string") {
    task.todo.content = input.subject;
  }
  if (input.status === "pending" || input.status === "in_progress" || input.status === "completed") {
    task.todo.status = input.status;
  }
}

const USER_NOISE = /^<(local-command-caveat|local-command-stdout|task-notification|system-reminder|command-message)\b/;

function userContent(content: unknown): { text: string; images: string[] } {
  if (typeof content === "string") {
    return { text: content, images: [] };
  }
  const parts = blocks(content);
  return {
    text: parts
      .filter((block) => block.type === "text")
      .map((block) => str(block.text))
      .join("\n"),
    images: parts.filter((block) => block.type === "image").map(imageUrl).filter((url): url is string => Boolean(url))
  };
}

// Only inline base64 images are shown; the webview's CSP allows data: images.
function imageUrl(block: Block): string | undefined {
  const source = (block as { source?: unknown }).source as { type?: string; media_type?: string; data?: string } | undefined;
  return source?.type === "base64" && source.media_type?.startsWith("image/") && source.data ? `data:${source.media_type};base64,${source.data}` : undefined;
}

function cleanUserText(raw: string): string {
  const text = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  const command = /<command-name>([\s\S]*?)<\/command-name>(?:[\s\S]*?<command-args>([\s\S]*?)<\/command-args>)?/.exec(text);
  if (command) {
    return `${command[1].trim()} ${(command[2] ?? "").trim()}`.trim();
  }
  return USER_NOISE.test(text) ? "" : text;
}

function resultNote(message: Raw, id: string): Item | undefined {
  if (!message.is_error && message.subtype === "success") {
    return undefined;
  }
  const errors: string[] = Array.isArray(message.errors) ? message.errors : [];
  const detail = errors.join("; ") || (message.subtype === "success" ? str(message.result) : "");
  const label = ERROR_LABELS[message.subtype] ?? "Error";
  return { kind: "note", id, text: detail ? `${label}: ${detail}` : label, tone: "error" };
}

function systemNote(message: Raw, id: string): Item | undefined {
  if (message.subtype === "api_retry") {
    const seconds = Math.round((message.retry_delay_ms ?? 0) / 1000);
    return { kind: "note", id, text: `API error${message.error_status ? ` ${message.error_status}` : ""}, retrying in ${seconds}s (attempt ${message.attempt}/${message.max_retries})`, tone: "muted" };
  }
  if (message.subtype === "compact_boundary") {
    const tokens = message.compact_metadata?.pre_tokens;
    return { kind: "note", id, text: `Conversation compacted${tokens ? ` · ${Math.round(tokens / 1000)}k tokens before` : ""}`, tone: "muted" };
  }
  if (message.subtype === "local_command_output" && str(message.content).trim()) {
    return { kind: "note", id, text: str(message.content).trim(), tone: "muted" };
  }
  return undefined;
}

export function buildItems(messages: SDKMessage[]): Item[] {
  const items: Item[] = [];
  const waiting = new Map<string, (result: ToolResult) => void>();
  const agents = new Map<string, Extract<Item, { kind: "agent" }>>();
  const background = new Set<string>();
  let partial = new Map<number, { kind: "text" | "thinking"; text: string }>();
  let latestTodos = -1;
  const tasks: { id?: string; todo: Todo }[] = [];

  const addTool = (id: string, name: string, input: Input) => {
    if (name in LOOKUP_TOOLS) {
      const last = items[items.length - 1];
      const call: Lookup = { id, name, label: lookupLabel(name, input), done: false };
      waiting.set(id, (result) => Object.assign(call, { done: true, error: result.isError }));
      if (last?.kind === "lookups") {
        last.calls.push(call);
      } else {
        items.push({ kind: "lookups", id: `lookups:${id}`, calls: [call], summary: "", pending: true });
      }
    } else if (EDIT_TOOLS.has(name)) {
      const item = editItem(id, name, input);
      waiting.set(id, (result) => Object.assign(item, { pending: false, error: result.isError ? result.text : undefined }));
      items.push(item);
    } else if (name === "Bash") {
      const item: Extract<Item, { kind: "bash" }> = { kind: "bash", id, command: str(input.command), description: str(input.description) || undefined, pending: true };
      waiting.set(id, (result) => Object.assign(item, { pending: false, output: result.text, error: result.isError }));
      items.push(item);
    } else if (name === "TodoWrite") {
      latestTodos = items.length;
      items.push(todoCard(id, todosOf(input)));
    } else if (name === "TaskCreate" || name === "TaskUpdate") {
      const task = name === "TaskCreate" ? { todo: { content: str(input.subject), status: "pending" as const } } : tasks.find((entry) => entry.id === str(input.taskId));
      if (!task) {
        return;
      }
      if (name === "TaskCreate") {
        tasks.push(task);
      } else {
        applyTaskUpdate(tasks, task, input);
      }
      latestTodos = items.length;
      const card = todoCard(id, tasks.map((entry) => entry.todo));
      items.push(card);
      if (name === "TaskCreate") {
        waiting.set(id, (result) => {
          const created = /#(\S+)/.exec(result.text)?.[1];
          if (result.isError || !created) {
            tasks.splice(tasks.indexOf(task), 1);
            Object.assign(card, todoCard(id, tasks.map((entry) => entry.todo)));
          } else {
            Object.assign(task, { id: created.replace(/:$/, "") });
          }
        });
      }
    } else if (name === "Agent" || name === "Task") {
      const item: Extract<Item, { kind: "agent" }> = { kind: "agent", id, toolUseId: id, subagentType: str(input.subagent_type) || "general-purpose", description: str(input.description) || str(input.prompt).slice(0, 100), pending: true };
      agents.set(id, item);
      if (input.run_in_background) {
        background.add(id);
      }
      waiting.set(id, (result) => Object.assign(item, { pending: background.has(id), error: result.isError ? result.text : undefined }));
      items.push(item);
    } else if (name === "Workflow") {
      items.push({ kind: "workflow", id, toolUseId: id, input });
    } else {
      const item: Extract<Item, { kind: "tool" }> = { kind: "tool", id, name, summary: toolSummary(input), pending: true };
      waiting.set(id, (result) => Object.assign(item, { pending: false, error: result.isError ? result.text : undefined }));
      items.push(item);
    }
  };

  const addAssistant = (message: Raw) => {
    const uuid = str(message.uuid) || `a${items.length}`;
    blocks(message.message?.content).forEach((block, index) => {
      const id = `${uuid}:${index}`;
      if (block.type === "text" && str(block.text).trim()) {
        items.push({ kind: "text", id, text: str(block.text) });
      } else if (block.type === "thinking" && str(block.thinking).trim()) {
        items.push({ kind: "thinking", id, text: str(block.thinking) });
      } else if (block.type === "tool_use") {
        addTool(str(block.id), str(block.name), (block.input as Input) ?? {});
      }
    });
  };

  const addUser = (message: Raw) => {
    const content = message.message?.content;
    blocks(content)
      .filter((block) => block.type === "tool_result")
      .forEach((block) => waiting.get(str(block.tool_use_id))?.({ text: resultText(block.content), isError: block.is_error === true }));
    const origin = message.origin as { kind?: string } | undefined;
    if (message.isSynthetic || message.isMeta || (origin && origin.kind !== "human")) {
      return;
    }
    const { text, images } = userContent(content);
    const clean = reviewSummary(text) ?? cleanUserText(text);
    if (text.startsWith("[Request interrupted")) {
      items.push({ kind: "note", id: str(message.uuid) || `u${items.length}`, text: "Interrupted", tone: "muted" });
    } else if (clean || images.length) {
      items.push({ kind: "user", id: str(message.uuid) || `u${items.length}`, text: clean, images });
    }
  };

  const addStream = (event: any) => {
    if (event.type === "message_start") {
      partial = new Map();
    } else if (event.type === "content_block_start") {
      const type = event.content_block?.type;
      if (type === "text" || type === "thinking") {
        partial.set(event.index, { kind: type, text: "" });
      }
    } else if (event.type === "content_block_delta") {
      const delta = event.delta;
      const kind = delta?.type === "text_delta" ? "text" : delta?.type === "thinking_delta" ? "thinking" : undefined;
      if (kind) {
        const entry = partial.get(event.index) ?? { kind, text: "" };
        entry.text += str(delta.text) + str(delta.thinking);
        partial.set(event.index, entry);
      }
    }
  };

  messages.forEach((raw, position) => {
    const message = raw as Raw;
    const id = str(message.uuid) || `m${position}`;
    if (message.type === "stream_event") {
      if (!message.parent_tool_use_id) {
        addStream(message.event);
      }
    } else if (message.type === "assistant" || message.type === "user") {
      if (message.parent_tool_use_id) {
        return;
      }
      if (message.type === "assistant") {
        partial = new Map();
        addAssistant(message);
      } else {
        addUser(message);
      }
    } else if (message.type === "result") {
      partial = new Map();
      const note = resultNote(message, id);
      if (note) {
        items.push(note);
      }
    } else if (message.type === "system") {
      if (message.subtype === "task_started" && message.tool_use_id) {
        const agent = agents.get(message.tool_use_id);
        if (agent) {
          agent.taskId = message.task_id;
        }
      } else if (message.subtype === "task_notification" && message.tool_use_id) {
        const agent = agents.get(message.tool_use_id);
        background.delete(message.tool_use_id);
        if (agent) {
          agent.pending = false;
          agent.error = message.status === "completed" ? agent.error : message.status;
        }
      } else {
        const note = systemNote(message, id);
        if (note) {
          items.push(note);
        }
      }
    }
  });

  partial.forEach((entry, index) => {
    if (entry.text) {
      items.push({ kind: entry.kind, id: `stream:${index}`, text: entry.text, streaming: true });
    }
  });

  items.forEach((item) => {
    if (item.kind === "lookups") {
      item.summary = summarizeLookups(item.calls);
      item.pending = item.calls.some((call) => !call.done);
    }
  });
  return items.filter((item, index) => item.kind !== "todos" || index === latestTodos);
}

function reviewSummary(text: string): string | undefined {
  if (!text.startsWith(REVIEW_PROMPT_START)) {
    return undefined;
  }
  const files = [...text.matchAll(/^Comment \S+: (.+?):\d+/gm)].map((match) => match[1].split("/").pop());
  const count = files.length;
  return `${count} review comment${count === 1 ? "" : "s"} on ${[...new Set(files)].join(", ")}`;
}

export type Row = Item | { kind: "hidden"; id: string; firstId: string; calls: number };

const CALL_KINDS = new Set<Item["kind"]>(["edit", "bash", "todos", "agent", "workflow", "tool"]);

const callCount = (item: Item): number => (item.kind === "lookups" ? item.calls.length : CALL_KINDS.has(item.kind) ? 1 : 0);

const showsInTextOnly = (item: Item): boolean => item.kind === "user" || item.kind === "text" || (item.kind === "note" && item.tone === "error");

export function textOnlyRows(items: Item[]): Row[] {
  const rows: Row[] = [];
  let gap: Item[] = [];
  for (const item of items) {
    if (!showsInTextOnly(item)) {
      gap.push(item);
      continue;
    }
    if (gap.length > 0 && rows.length > 0) {
      rows.push({ kind: "hidden", id: `hidden:${gap[0].id}`, firstId: gap[0].id, calls: gap.reduce((sum, hidden) => sum + callCount(hidden), 0) });
    }
    gap = [];
    rows.push(item);
  }
  return rows;
}

function isHumanTurnStart(message: Raw): boolean {
  if (message.type !== "user" || message.parent_tool_use_id || message.isSynthetic || message.isMeta) {
    return false;
  }
  const origin = message.origin as { kind?: string } | undefined;
  return (!origin || origin.kind === "human") && !blocks(message.message?.content).some((block) => block.type === "tool_result");
}

// Output tokens of the current turn: the largest usage seen per API message since the last human message.
export function turnOutputTokens(messages: SDKMessage[]): number {
  let perMessage = new Map<string, number>();
  let streaming = "";
  const record = (id: string, tokens: unknown) => {
    if (id && typeof tokens === "number") {
      perMessage.set(id, Math.max(perMessage.get(id) ?? 0, tokens));
    }
  };
  for (const raw of messages) {
    const message = raw as Raw;
    if (isHumanTurnStart(message)) {
      perMessage = new Map();
    } else if (message.parent_tool_use_id) {
      continue;
    } else if (message.type === "assistant") {
      record(str(message.message?.id), message.message?.usage?.output_tokens);
    } else if (message.type === "stream_event") {
      const event = message.event as any;
      if (event.type === "message_start") {
        streaming = str(event.message?.id);
        record(streaming, event.message?.usage?.output_tokens);
      } else if (event.type === "message_delta") {
        record(streaming, event.usage?.output_tokens);
      }
    }
  }
  return [...perMessage.values()].reduce((sum, tokens) => sum + tokens, 0);
}
