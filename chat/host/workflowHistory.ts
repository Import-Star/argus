import * as fs from "fs";
import * as path from "path";

interface Line {
  type?: string;
  uuid?: string;
  timestamp?: string;
  session_id?: string;
  message?: unknown;
}

interface JournalEntry {
  type?: string;
  agentId?: string;
  label?: string;
  phase?: string;
}

function blocks(message: unknown): Record<string, unknown>[] {
  const content = (message as { content?: unknown } | undefined)?.content;
  return Array.isArray(content) ? content : [];
}

function text(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  return Array.isArray(content) ? content.map((block) => (typeof block?.text === "string" ? block.text : "")).join("") : "";
}

function field(source: string, pattern: RegExp): string | undefined {
  return source.match(pattern)?.[1]?.trim();
}

// The run's journal has one "started" line per agent (label, phase) and one "result" line when it finishes.
export function workflowProgress(runDir: string): Record<string, unknown>[] {
  let journal: JournalEntry[];
  try {
    journal = fs
      .readFileSync(path.join(runDir, "journal.jsonl"), "utf8")
      .split("\n")
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as JournalEntry];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
  const finished = new Set(journal.filter((entry) => entry.type === "result").map((entry) => entry.agentId));
  const started = journal.filter((entry) => entry.type === "started" && entry.agentId);
  const phases = [...new Set(started.flatMap((entry) => (entry.phase ? [entry.phase] : [])))];
  return [
    ...phases.map((title, index) => ({ type: "workflow_phase", index: index + 1, title })),
    ...started.map((entry, index) => ({
      type: "workflow_agent",
      index: index + 1,
      label: entry.label,
      phaseIndex: entry.phase ? phases.indexOf(entry.phase) + 1 : undefined,
      agentId: entry.agentId,
      state: finished.has(entry.agentId) ? "done" : "running"
    }))
  ];
}

// Task events aren't saved in the transcript, so rebuild a workflow's from its tool result, notification and run folder.
export function withWorkflowTasks<T extends Line>(messages: T[]): T[] {
  const workflowUses = new Set<string>();
  const taskIds = new Set<string>();
  return messages.flatMap((message): T[] => {
    const base = { type: "system", session_id: message.session_id, timestamp: message.timestamp };
    const added: Record<string, unknown>[] = [];
    for (const block of blocks(message.message)) {
      if (message.type === "assistant" && block.type === "tool_use" && block.name === "Workflow") {
        workflowUses.add(String(block.id));
      }
      const id = String(block.tool_use_id);
      const result = text(block.content);
      const taskId = field(result, /Task ID:\s*(\S+)/);
      if (block.type === "tool_result" && workflowUses.has(id) && taskId) {
        const runDir = field(result, /^Transcript dir:(.+)$/m);
        taskIds.add(taskId);
        added.push(
          { ...base, subtype: "task_started", uuid: `${message.uuid}:${taskId}:started`, task_id: taskId, tool_use_id: id, task_type: "local_workflow", description: field(result, /^Summary:(.+)$/m) ?? "" },
          { ...base, subtype: "task_progress", uuid: `${message.uuid}:${taskId}:progress`, task_id: taskId, tool_use_id: id, description: "", usage: { total_tokens: 0, tool_uses: 0, duration_ms: 0 }, workflow_progress: runDir ? workflowProgress(runDir) : [] }
        );
      }
    }
    const note = message.type === "user" ? text((message.message as { content?: unknown } | undefined)?.content) : "";
    const taskId = field(note, /<task-id>([^<]+)<\/task-id>/);
    if (taskId && taskIds.has(taskId)) {
      const status = field(note, /<status>([^<]+)<\/status>/);
      added.push({
        ...base,
        subtype: "task_notification",
        uuid: `${message.uuid}:${taskId}:notification`,
        task_id: taskId,
        tool_use_id: field(note, /<tool-use-id>([^<]+)<\/tool-use-id>/),
        status: status === "completed" || status === "failed" ? status : "stopped",
        summary: field(note, /<summary>([^<]*)<\/summary>/) ?? "",
        output_file: ""
      });
    }
    return [message, ...(added as unknown as T[])];
  });
}
