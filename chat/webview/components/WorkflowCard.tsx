import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { post, setUi, useSession } from "../store";
import { agentCounts, findWorkflow, formatDuration, taskGraph, type AgentCounts, type WorkflowInfo } from "../workflow";
import "./workflow.css";

export function useElapsed(durationMs: number, running: boolean): number {
  const base = useRef({ durationMs, at: Date.now() });
  const [, tick] = useState(0);
  if (base.current.durationMs !== durationMs) {
    base.current = { durationMs, at: Date.now() };
  }
  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return running ? durationMs + (Date.now() - base.current.at) : durationMs;
}

function countsLine(counts: AgentCounts): string {
  return `${counts.done} of ${counts.total} agents done, ${counts.stopped} stopped, ${counts.failed} failed`;
}

function ProgressBar({ counts }: { counts: AgentCounts }) {
  const segments: [string, number][] = [
    ["done", counts.done],
    ["failed", counts.failed],
    ["stopped", counts.stopped],
    ["running", counts.running],
    ["waiting", counts.waiting]
  ];
  return (
    <div class="wf-bar" role="img" aria-label={countsLine(counts)}>
      {segments.map(([kind, count]) => (count > 0 ? <div key={kind} class={`wf-seg wf-seg-${kind}`} style={{ flex: count }} /> : null))}
    </div>
  );
}

function title(workflow: WorkflowInfo): string {
  switch (workflow.status) {
    case "running":
      return "Running workflow";
    case "done":
      return `Ran workflow ${workflow.name}`;
    case "failed":
      return `Workflow ${workflow.name} failed`;
    case "stopped":
      return `Workflow ${workflow.name} stopped`;
    default:
      return `Workflow ${workflow.name}`;
  }
}

function StatusIcon({ status }: { status: WorkflowInfo["status"] }) {
  if (status === "running") {
    return <span class="spinner" />;
  }
  const path = status === "done" ? "M5 12l5 5L20 7" : status === "unknown" ? "M5 12h14" : "M6 6l12 12M18 6L6 18";
  return (
    <svg class={`wf-icon wf-icon-${status}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

export function WorkflowCard({ sessionId, toolUseId, input }: { sessionId: string; toolUseId: string; input: Record<string, unknown> }) {
  const { messages, ui } = useSession(sessionId);
  const workflow = useMemo(() => findWorkflow(taskGraph(messages), toolUseId), [messages, toolUseId]);
  const running = workflow?.status === "running";
  const elapsed = useElapsed(workflow?.durationMs ?? 0, running);
  if (!workflow) {
    return <div class="wf-card">{String(input.name ?? input.title ?? "Workflow")}</div>;
  }
  const counts = agentCounts(workflow.agents);
  const target = workflow.taskId ?? workflow.toolUseId;
  const viewing = ui.side === "workflow" && ui.workflowTaskId === target;
  return (
    <div class={`wf-card wf-${workflow.status}`}>
      <div class="wf-head">
        <StatusIcon status={workflow.status} />
        <span class="wf-title">{title(workflow)}</span>
        {running && workflow.name !== "workflow" && <code class="wf-name">{workflow.name}</code>}
        {workflow.durationMs > 0 && <span class="wf-time muted">{formatDuration(elapsed)}</span>}
      </div>
      {counts.total > 0 && (
        <>
          <ProgressBar counts={counts} />
          <div class="wf-counts muted">{countsLine(counts)}</div>
        </>
      )}
      {workflow.summary && <div class="wf-summary">{workflow.summary}</div>}
      <div class="wf-actions">
        <button type="button" aria-pressed={viewing} onClick={() => setUi(sessionId, { side: "workflow", workflowTaskId: target })}>
          {viewing ? "Viewing workflow" : "View workflow"}
        </button>
        {running && workflow.taskId && (
          <button type="button" onClick={() => post({ type: "stopTask", sessionId, taskId: workflow.taskId! })}>
            Stop workflow
          </button>
        )}
      </div>
    </div>
  );
}
