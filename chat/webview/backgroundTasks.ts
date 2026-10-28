import type { SDKMessage } from "../../src/chat/protocol";

export type BackgroundState = "running" | "done" | "failed" | "stopped";

export interface BackgroundTask {
  id: string;
  kind: string;
  label: string;
  description: string;
  agentType?: string;
  toolUseId?: string;
  state: BackgroundState;
  startedAt: number;
  endedAt?: number;
}

interface Tracked extends BackgroundTask {
  runId?: string;
  parentId?: string;
  background: boolean;
  ambient: boolean;
}

type System = Extract<SDKMessage, { type: "system" }>;

const LABELS: Record<string, string> = {
  local_bash: "shell",
  local_agent: "agent",
  monitor: "monitor",
  local_workflow: "workflow",
  mcp_task: "mcp task",
  remote_agent: "remote agent"
};

const STATES: Record<string, BackgroundState> = { running: "running", completed: "done", failed: "failed", killed: "stopped", stopped: "stopped" };

// Live messages carry no time, so each one is stamped as it reaches the webview; replayed history has its own timestamp.
const arrivals = new Map<string, number>();

export function noteArrival(message: SDKMessage): void {
  if (message.type === "system" && message.uuid) {
    const stamped = (message as { timestamp?: string }).timestamp;
    arrivals.set(message.uuid, (stamped && Date.parse(stamped)) || Date.now());
  }
}

function arrivedAt(message: System): number {
  return arrivals.get(message.uuid) ?? Date.now();
}

// A newer run of the same task replaces the old one; frames from an older run are late and ignored.
function touch(tasks: Map<string, Tracked>, id: string, runId: string | undefined, at: number): Tracked | undefined {
  const existing = tasks.get(id);
  if (existing && runId && existing.runId && runId < existing.runId) {
    return undefined;
  }
  if (existing && !(runId && existing.runId && runId > existing.runId)) {
    existing.runId ??= runId;
    return existing;
  }
  const created: Tracked = { id, runId, kind: "", label: "", description: "", state: "running", startedAt: at, background: true, ambient: false };
  tasks.set(id, created);
  return created;
}

function setKind(task: Tracked, kind: string | undefined): void {
  task.kind = kind ?? task.kind;
  task.label = LABELS[task.kind] ?? task.kind.replace(/^local_/, "").replace(/_/g, " ");
}

function finish(task: Tracked, state: BackgroundState, at: number): void {
  task.state = state;
  task.endedAt ??= at;
}

function apply(message: System, tasks: Map<string, Tracked>): void {
  const at = arrivedAt(message);
  switch (message.subtype) {
    case "task_started": {
      const task = touch(tasks, message.task_id, message.run_id, at);
      if (task) {
        setKind(task, message.task_type ?? (message.subagent_type ? "local_agent" : task.kind));
        Object.assign(task, {
          description: message.description,
          agentType: message.subagent_type ?? task.agentType,
          toolUseId: message.tool_use_id ?? task.toolUseId,
          parentId: message.parent_task_id ?? task.parentId,
          background: message.is_backgrounded ?? task.kind !== "local_agent",
          ambient: Boolean(message.ambient || message.skip_transcript)
        });
      }
      return;
    }
    case "task_updated": {
      const task = touch(tasks, message.task_id, message.run_id, at);
      if (task) {
        const state = STATES[message.patch.status ?? ""];
        task.description = message.patch.description ?? task.description;
        task.background = message.patch.is_backgrounded ?? task.background;
        if (state && state !== "running") {
          finish(task, state, at);
        }
      }
      return;
    }
    case "task_notification": {
      const task = touch(tasks, message.task_id, message.run_id, at);
      if (task) {
        task.toolUseId ??= message.tool_use_id;
        finish(task, message.status === "completed" ? "done" : message.status, at);
      }
      return;
    }
    case "background_tasks_changed": {
      const live = new Set(message.tasks.map((entry) => entry.task_id));
      for (const entry of message.tasks) {
        const task = touch(tasks, entry.task_id, entry.run_id, at);
        if (task) {
          setKind(task, task.kind || entry.task_type);
          Object.assign(task, {
            description: task.description || entry.description,
            agentType: task.agentType ?? entry.subagent_type,
            parentId: task.parentId ?? entry.parent_task_id,
            background: true,
            ambient: Boolean(entry.ambient)
          });
        }
      }
      for (const task of tasks.values()) {
        if (task.background && task.state === "running" && !live.has(task.id)) {
          finish(task, "done", at);
        }
      }
    }
  }
}

export function backgroundTasks(messages: SDKMessage[]): BackgroundTask[] {
  const tasks = new Map<string, Tracked>();
  for (const message of messages) {
    if (message.type === "system") {
      apply(message, tasks);
    }
  }
  return [...tasks.values()]
    .filter((task) => task.background && !task.ambient && !(task.kind === "local_agent" && tasks.get(task.parentId ?? "")?.kind === "local_workflow"))
    .map(({ runId, parentId, background, ambient, ...task }) => task);
}
