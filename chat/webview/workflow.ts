import type { SDKMessage } from "../../src/chat/protocol";

export type AgentStatus = "waiting" | "running" | "done" | "failed" | "stopped";
export type WorkflowStatus = "running" | "done" | "failed" | "stopped" | "unknown";

export interface AgentInfo {
  taskId: string;
  toolUseId?: string;
  description: string;
  subagentType?: string;
  status: AgentStatus;
  tokens: number;
  toolUses: number;
  durationMs: number;
  lastTool?: string;
  summary?: string;
  error?: string;
  phase?: string;
  startIndex: number;
  inWorkflow?: boolean;
  agentId?: string;
  model?: string;
  attempt?: number;
  promptPreview?: string;
  resultPreview?: string;
  startedAt?: number;
}

export interface WorkflowColumn {
  title: string;
  declared: boolean;
  agents: AgentInfo[];
}

export interface WorkflowInfo {
  taskId?: string;
  toolUseId?: string;
  name: string;
  description?: string;
  status: WorkflowStatus;
  summary?: string;
  tokens: number;
  durationMs: number;
  agents: AgentInfo[];
  columns: WorkflowColumn[];
}

export interface TaskGraph {
  workflows: WorkflowInfo[];
  standalone: AgentInfo[];
}

export interface AgentCounts {
  total: number;
  done: number;
  failed: number;
  stopped: number;
  running: number;
  waiting: number;
}

interface SnapshotPhase {
  index: number;
  title: string;
}

interface SnapshotAgent {
  index: number;
  label: string;
  phaseIndex?: number;
  phaseTitle?: string;
  agentId?: string;
  model?: string;
  state?: string;
  startedAt?: number;
  attempt?: number;
  promptPreview?: string;
  resultPreview?: string;
  error?: string;
  tokens: number;
  toolCalls: number;
  durationMs: number;
}

interface Snapshot {
  phases: SnapshotPhase[];
  agents: SnapshotAgent[];
}

interface Task {
  taskId: string;
  runId?: string;
  toolUseId?: string;
  parentTaskId?: string;
  taskType?: string;
  workflowName?: string;
  description: string;
  subagentType?: string;
  status: AgentStatus;
  tokens: number;
  toolUses: number;
  durationMs: number;
  lastTool?: string;
  summary?: string;
  error?: string;
  ambient: boolean;
  startIndex: number;
  endIndex?: number;
  snapshot?: Snapshot;
}

interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
  index: number;
}

interface WorkflowResult {
  taskId?: string;
  workflowName?: string;
  summary?: string;
}

interface Meta {
  name?: string;
  description?: string;
  phases: string[];
}

const TERMINAL = new Set<AgentStatus>(["done", "failed", "stopped"]);
const AGENT_TOOLS = new Set(["Agent", "Task"]);
const OTHER_TASK_TYPES = new Set(["local_workflow", "local_bash", "monitor", "mcp_task", "remote_agent"]);
const STRING = String.raw`(["'` + "`" + String.raw`])((?:\\.|(?!\1)[^\\])*)\1`;

function unquote(text: string): string {
  return text.replace(/\\(.)/g, "$1");
}

function matchClose(text: string, open: number): number {
  let depth = 0;
  let quote = "";
  for (let i = open; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === "\\") {
        i++;
      } else if (char === quote) {
        quote = "";
      }
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === "{" || char === "[") {
      depth++;
    } else if (char === "}" || char === "]") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return text.length;
}

function stringAfter(text: string, key: string): string | undefined {
  const match = new RegExp(String.raw`\b${key}\s*:\s*` + STRING).exec(text);
  return match ? unquote(match[2]) : undefined;
}

export function parseMeta(script: string): Meta {
  const start = script.search(/export\s+const\s+meta\s*=/);
  const open = start < 0 ? -1 : script.indexOf("{", start);
  if (open < 0) {
    return { phases: [] };
  }
  const body = script.slice(open, matchClose(script, open) + 1);
  const phasesAt = body.search(/\bphases\s*:\s*\[/);
  const phasesOpen = phasesAt < 0 ? -1 : body.indexOf("[", phasesAt);
  const phasesBody = phasesOpen < 0 ? "" : body.slice(phasesOpen, matchClose(body, phasesOpen) + 1);
  const outside = phasesOpen < 0 ? body : body.slice(0, phasesOpen) + body.slice(phasesOpen + phasesBody.length);
  const titles = [...phasesBody.matchAll(new RegExp(String.raw`\btitle\s*:\s*` + STRING, "g"))].map((match) => unquote(match[2]));
  const literals = [...phasesBody.matchAll(new RegExp(STRING, "g"))].map((match) => unquote(match[2]));
  return { name: stringAfter(outside, "name"), description: stringAfter(outside, "description"), phases: titles.length > 0 ? titles : literals };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseSnapshot(value: unknown): Snapshot | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const snapshot: Snapshot = { phases: [], agents: [] };
  for (const entry of value.map(asRecord)) {
    const index = num(entry.index);
    if (index === undefined) {
      continue;
    }
    if (entry.type === "workflow_phase") {
      snapshot.phases.push({ index, title: str(entry.title) ?? `Phase ${index}` });
    } else if (entry.type === "workflow_agent") {
      snapshot.agents.push({
        index,
        label: str(entry.label) ?? `agent ${index}`,
        phaseIndex: num(entry.phaseIndex),
        phaseTitle: str(entry.phaseTitle),
        agentId: str(entry.agentId),
        model: str(entry.model),
        state: str(entry.state),
        startedAt: num(entry.startedAt),
        attempt: num(entry.attempt),
        promptPreview: str(entry.promptPreview),
        resultPreview: str(entry.resultPreview),
        error: str(entry.error),
        tokens: num(entry.tokens) ?? 0,
        toolCalls: num(entry.toolCalls) ?? 0,
        durationMs: num(entry.durationMs) ?? 0
      });
    }
  }
  snapshot.phases.sort((a, b) => a.index - b.index);
  snapshot.agents.sort((a, b) => a.index - b.index);
  return snapshot;
}

function blocks(content: unknown): Record<string, unknown>[] {
  return Array.isArray(content) ? content.map(asRecord) : [];
}

function resultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  return blocks(content)
    .map((block) => str(block.text) ?? "")
    .join("");
}

function parseWorkflowResult(text: string): WorkflowResult {
  try {
    const value = asRecord(JSON.parse(text));
    return { taskId: str(value.taskId), workflowName: str(value.workflowName), summary: str(value.summary) };
  } catch {
    return {};
  }
}

function mapStatus(status: string | undefined): AgentStatus | undefined {
  switch (status) {
    case "pending":
    case "paused":
      return "waiting";
    case "running":
      return "running";
    case "completed":
      return "done";
    case "failed":
      return "failed";
    case "killed":
    case "stopped":
      return "stopped";
    default:
      return undefined;
  }
}

function mapAgentState(state: string | undefined, startedAt: number | undefined): AgentStatus {
  switch (state) {
    case "done":
    case "completed":
    case "complete":
      return "done";
    case "failed":
    case "error":
    case "errored":
      return "failed";
    case "stopped":
    case "killed":
    case "cancelled":
    case "canceled":
    case "aborted":
      return "stopped";
    case "queued":
    case "pending":
    case "waiting":
      return "waiting";
    default:
      return startedAt === undefined ? "waiting" : "running";
  }
}

function newTask(taskId: string, index: number): Task {
  return { taskId, description: "", status: "running", tokens: 0, toolUses: 0, durationMs: 0, ambient: false, startIndex: index };
}

// Returns undefined for a late frame from an older run; resets the task when a newer run begins.
function touch(tasks: Map<string, Task>, taskId: string, runId: string | undefined, index: number): Task | undefined {
  const existing = tasks.get(taskId);
  if (!existing) {
    const created = newTask(taskId, index);
    created.runId = runId;
    tasks.set(taskId, created);
    return created;
  }
  if (runId && existing.runId && runId < existing.runId) {
    return undefined;
  }
  if (runId && existing.runId && runId > existing.runId) {
    const fresh = newTask(taskId, index);
    fresh.runId = runId;
    tasks.set(taskId, fresh);
    return fresh;
  }
  existing.runId ??= runId;
  return existing;
}

function applyUsage(task: Task, usage: { total_tokens: number; tool_uses: number; duration_ms: number } | undefined): void {
  if (usage) {
    task.tokens = usage.total_tokens;
    task.toolUses = usage.tool_uses;
    task.durationMs = usage.duration_ms;
  }
}

function applySystem(message: Extract<SDKMessage, { type: "system" }>, tasks: Map<string, Task>, index: number): void {
  switch (message.subtype) {
    case "task_started": {
      const task = touch(tasks, message.task_id, message.run_id, index);
      if (task) {
        Object.assign(task, {
          toolUseId: message.tool_use_id ?? task.toolUseId,
          parentTaskId: message.parent_task_id ?? task.parentTaskId,
          taskType: message.task_type ?? task.taskType,
          workflowName: message.workflow_name ?? task.workflowName,
          description: message.description,
          subagentType: message.subagent_type ?? task.subagentType,
          ambient: Boolean(message.ambient || message.skip_transcript),
          startIndex: index
        });
      }
      return;
    }
    case "task_progress": {
      const task = touch(tasks, message.task_id, message.run_id, index);
      if (task) {
        task.toolUseId ??= message.tool_use_id;
        task.description = message.description || task.description;
        task.subagentType ??= message.subagent_type;
        task.lastTool = message.last_tool_name ?? task.lastTool;
        task.summary = message.summary ?? task.summary;
        task.snapshot = parseSnapshot(asRecord(message).workflow_progress) ?? task.snapshot;
        applyUsage(task, message.usage);
      }
      return;
    }
    case "task_updated": {
      const task = touch(tasks, message.task_id, message.run_id, index);
      if (task) {
        task.status = mapStatus(message.patch.status) ?? task.status;
        task.description = message.patch.description ?? task.description;
        task.error = message.patch.error ?? task.error;
        task.endIndex = TERMINAL.has(task.status) ? (task.endIndex ?? index) : undefined;
      }
      return;
    }
    case "task_notification": {
      const task = touch(tasks, message.task_id, message.run_id, index);
      if (task) {
        task.status = mapStatus(message.status) ?? task.status;
        task.toolUseId ??= message.tool_use_id;
        task.summary = message.summary || task.summary;
        task.endIndex ??= index;
        applyUsage(task, message.usage);
      }
      return;
    }
    case "background_tasks_changed":
      for (const entry of message.tasks) {
        if (!tasks.has(entry.task_id)) {
          Object.assign(touch(tasks, entry.task_id, entry.run_id, index) ?? {}, {
            taskType: entry.task_type,
            description: entry.description,
            subagentType: entry.subagent_type,
            parentTaskId: entry.parent_task_id,
            ambient: Boolean(entry.ambient)
          });
        }
      }
      return;
  }
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function phaseOf(description: string, phases: string[]): string | undefined {
  const hint = /^\s*\[?([^\]:]+?)\]?\s*:/.exec(description)?.[1] ?? /\bphase\s*[:=]\s*["']?([\w -]+)/i.exec(description)?.[1];
  const wanted = hint ? normalize(hint) : "";
  const text = normalize(description);
  return phases.find((title) => {
    const key = normalize(title);
    if (!key) {
      return false;
    }
    const byHint = wanted.length >= 3 && (key === wanted || key.startsWith(wanted) || wanted.startsWith(key));
    return byHint || text.startsWith(key + " ");
  });
}

function agentInfo(task: Task): AgentInfo {
  return {
    taskId: task.taskId,
    toolUseId: task.toolUseId,
    description: task.description,
    subagentType: task.subagentType,
    status: task.status,
    tokens: task.tokens,
    toolUses: task.toolUses,
    durationMs: task.durationMs,
    lastTool: task.lastTool,
    summary: task.summary,
    error: task.error,
    startIndex: task.startIndex
  };
}

function snapshotAgents(task: Task, snapshot: Snapshot): AgentInfo[] {
  const finished = TERMINAL.has(task.status);
  return snapshot.agents.map((entry) => {
    const state = mapAgentState(entry.state, entry.startedAt);
    const status = finished && !TERMINAL.has(state) ? "stopped" : state;
    const phase = snapshot.phases.find((candidate) => candidate.index === entry.phaseIndex)?.title ?? entry.phaseTitle;
    return {
      taskId: `${task.taskId}:${entry.index}`,
      description: entry.label,
      status,
      tokens: entry.tokens,
      toolUses: entry.toolCalls,
      durationMs: entry.durationMs,
      summary: entry.resultPreview,
      error: entry.error,
      phase,
      startIndex: entry.index,
      inWorkflow: true,
      agentId: entry.agentId,
      model: entry.model,
      attempt: entry.attempt,
      promptPreview: entry.promptPreview,
      resultPreview: entry.resultPreview,
      startedAt: entry.startedAt
    };
  });
}

export function agentDuration(agent: AgentInfo, now: number): number {
  return agent.status === "running" && agent.startedAt !== undefined ? Math.max(agent.durationMs, now - agent.startedAt) : agent.durationMs;
}

export function outputKey(agent: AgentInfo): string {
  return agent.agentId ?? agent.taskId;
}

function mergePhases(snapshot: Snapshot | undefined, declared: string[]): string[] {
  const titles = snapshot?.phases.map((phase) => phase.title) ?? [];
  return [...titles, ...declared.filter((title) => !titles.includes(title))];
}

function buildColumns(agents: AgentInfo[], phases: string[]): WorkflowColumn[] {
  const columns: WorkflowColumn[] = phases.map((title) => ({ title, declared: true, agents: [] }));
  const loose: WorkflowColumn = { title: "Agents", declared: false, agents: [] };
  for (const agent of agents) {
    const column = columns.find((candidate) => candidate.title === agent.phase);
    (column ?? loose).agents.push(agent);
  }
  return loose.agents.length > 0 || columns.length === 0 ? [...columns, loose] : columns;
}

export function agentCounts(agents: AgentInfo[]): AgentCounts {
  const count = (status: AgentStatus) => agents.filter((agent) => agent.status === status).length;
  return { total: agents.length, done: count("done"), failed: count("failed"), stopped: count("stopped"), running: count("running"), waiting: count("waiting") };
}

function workflowStatus(task: Task | undefined, launched: boolean, agents: AgentInfo[]): WorkflowStatus {
  if (task) {
    return task.status === "done" || task.status === "failed" || task.status === "stopped" ? task.status : "running";
  }
  if (launched) {
    return agents.some((agent) => agent.status === "running" || agent.status === "waiting") ? "running" : "unknown";
  }
  return "running";
}

function derive(messages: SDKMessage[]): TaskGraph {
  const tasks = new Map<string, Task>();
  const toolUses = new Map<string, ToolUse>();
  const results = new Map<string, WorkflowResult>();
  messages.forEach((message, index) => {
    if (message.type === "system") {
      applySystem(message, tasks, index);
    } else if (message.type === "assistant") {
      for (const block of blocks(message.message.content)) {
        const id = str(block.id);
        if (block.type === "tool_use" && id) {
          toolUses.set(id, { id, name: str(block.name) ?? "", input: asRecord(block.input), index });
        }
      }
    } else if (message.type === "user" && toolUses.size > 0) {
      for (const block of blocks(message.message.content)) {
        const id = str(block.tool_use_id);
        if (block.type === "tool_result" && id && toolUses.get(id)?.name === "Workflow") {
          results.set(id, parseWorkflowResult(resultText(block.content)));
        }
      }
    }
  });

  const live = [...tasks.values()].filter((task) => !task.ambient);
  const workflowTasks = live.filter((task) => task.taskType === "local_workflow" || task.workflowName !== undefined);
  const workflowUses = [...toolUses.values()].filter((use) => use.name === "Workflow");
  const workflows: { use?: ToolUse; task?: Task }[] = workflowUses.map((use) => ({
    use,
    task: workflowTasks.find((task) => task.toolUseId === use.id) ?? workflowTasks.find((task) => task.taskId === results.get(use.id)?.taskId)
  }));
  const linked = new Set(workflows.map((entry) => entry.task?.taskId));
  for (const task of workflowTasks.filter((candidate) => !linked.has(candidate.taskId))) {
    workflows.push({ task });
  }
  const workflowOf = (task: Task, depth = 0): string | undefined => {
    const direct = workflows.find((entry) => entry.task && entry.task.taskId === task.parentTaskId);
    if (direct) {
      return direct.task?.taskId;
    }
    const byTool = workflows.find((entry) => entry.use && entry.use.id === task.toolUseId);
    if (byTool) {
      return byTool.task?.taskId ?? byTool.use?.id;
    }
    const parent = task.parentTaskId ? tasks.get(task.parentTaskId) : undefined;
    if (parent && depth < 8) {
      return workflowOf(parent, depth + 1);
    }
    if (task.toolUseId && AGENT_TOOLS.has(toolUses.get(task.toolUseId)?.name ?? "")) {
      return undefined;
    }
    const open = workflows.filter((entry) => entry.task && entry.task.startIndex <= task.startIndex && (entry.task.endIndex ?? Infinity) >= task.startIndex);
    return open.sort((a, b) => (b.task?.startIndex ?? 0) - (a.task?.startIndex ?? 0))[0]?.task?.taskId;
  };

  const agentTasks = live.filter((task) => !OTHER_TASK_TYPES.has(task.taskType ?? "") && task.workflowName === undefined);
  const owner = new Map(agentTasks.map((task) => [task.taskId, workflowOf(task)]));
  const toInfos = (list: Task[]) => list.map(agentInfo).sort((a, b) => a.startIndex - b.startIndex);
  const standalone = toInfos(agentTasks.filter((task) => !owner.get(task.taskId)));

  return {
    workflows: workflows.map(({ use, task }) => {
      const meta = parseMeta(str(use?.input.script) ?? "");
      const result = use ? results.get(use.id) : undefined;
      const snapshot = task?.snapshot;
      const agents =
        task && snapshot
          ? snapshotAgents(task, snapshot)
          : toInfos(agentTasks.filter((candidate) => owner.get(candidate.taskId) === (task?.taskId ?? use?.id)));
      if (!snapshot) {
        for (const agent of agents) {
          agent.phase = phaseOf(agent.description, meta.phases);
        }
      }
      const tokens = Math.max(task?.tokens ?? 0, agents.reduce((sum, agent) => sum + agent.tokens, 0));
      const durationMs = Math.max(task?.durationMs ?? 0, ...agents.map((agent) => agent.durationMs));
      return {
        taskId: task?.taskId ?? result?.taskId,
        toolUseId: use?.id ?? task?.toolUseId,
        name: meta.name ?? task?.workflowName ?? result?.workflowName ?? str(use?.input.name) ?? str(use?.input.title) ?? "workflow",
        description: meta.description ?? str(use?.input.description),
        status: workflowStatus(task, Boolean(result), agents),
        summary: task && TERMINAL.has(task.status) ? task.summary : undefined,
        tokens,
        durationMs,
        agents,
        columns: buildColumns(agents, mergePhases(snapshot, meta.phases))
      };
    }),
    standalone
  };
}

const cache = new WeakMap<SDKMessage[], TaskGraph>();

export function taskGraph(messages: SDKMessage[]): TaskGraph {
  let graph = cache.get(messages);
  if (!graph) {
    graph = derive(messages);
    cache.set(messages, graph);
  }
  return graph;
}

export function findWorkflow(graph: TaskGraph, id: string | undefined): WorkflowInfo | undefined {
  return id ? graph.workflows.find((workflow) => workflow.taskId === id || workflow.toolUseId === id) : undefined;
}

export function defaultWorkflow(graph: TaskGraph): WorkflowInfo | undefined {
  return [...graph.workflows].reverse().find((workflow) => workflow.status === "running") ?? graph.workflows.at(-1);
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s` : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens);
}
