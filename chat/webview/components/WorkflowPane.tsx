import { useEffect, useMemo } from "preact/hooks";
import { post, setUi, useSession } from "../store";
import { agentCounts, defaultWorkflow, findWorkflow, formatDuration, formatTokens, taskGraph, type AgentInfo, type AgentStatus, type WorkflowColumn, type WorkflowInfo } from "../workflow";
import { useElapsed } from "./WorkflowCard";
import "./workflow.css";

const GLYPHS: Record<Exclude<AgentStatus, "running">, string> = {
  done: "M5 12l5 5L20 7",
  failed: "M6 6l12 12M18 6L6 18",
  stopped: "M5 12h14",
  waiting: ""
};

function Glyph({ status }: { status: AgentStatus }) {
  if (status === "running") {
    return <span class="spinner" role="img" aria-label="running" />;
  }
  if (status === "waiting") {
    return <span class="wf-dot" role="img" aria-label="waiting" />;
  }
  return (
    <svg class={`wf-icon wf-icon-${status}`} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" role="img" aria-label={status}>
      <path d={GLYPHS[status]} />
    </svg>
  );
}

function AgentRow({ agent, selected, onSelect }: { agent: AgentInfo; selected: boolean; onSelect(): void }) {
  const result = agent.status === "failed" ? (agent.error ?? agent.summary ?? "failed") : agent.summary;
  return (
    <button type="button" class={`wf-agent wf-agent-${agent.status}`} aria-current={selected} onClick={onSelect}>
      <Glyph status={agent.status} />
      <span class="wf-label mono">{agent.description || agent.taskId}</span>
      {result && (
        <span class="wf-result muted" title={result}>
          {result}
        </span>
      )}
      {agent.durationMs > 0 && <span class="wf-dur muted">{formatDuration(agent.durationMs)}</span>}
    </button>
  );
}

function columnState(column: WorkflowColumn): "done" | "active" | "pending" {
  if (column.agents.length === 0) {
    return "pending";
  }
  return column.agents.every((agent) => agent.status === "done" || agent.status === "failed" || agent.status === "stopped") ? "done" : "active";
}

function Column({ column, index, selectedId, onSelect }: { column: WorkflowColumn; index: number; selectedId?: string; onSelect(agent: AgentInfo): void }) {
  const finished = column.agents.filter((agent) => agent.status === "done").length;
  return (
    <div class="wf-column">
      <h2 class={`wf-column-head wf-column-${columnState(column)}`}>
        {column.declared && <span class="wf-step">{index + 1}</span>}
        {column.title}
        <span class="wf-column-count">{column.agents.length === 0 ? "waiting" : `${finished} of ${column.agents.length}`}</span>
      </h2>
      {column.agents.map((agent) => (
        <AgentRow key={agent.taskId} agent={agent} selected={agent.taskId === selectedId} onSelect={() => onSelect(agent)} />
      ))}
    </div>
  );
}

function AgentDetail({ sessionId, agent, output }: { sessionId: string; agent: AgentInfo; output?: string }) {
  const active = agent.status === "running" || agent.status === "waiting";
  useEffect(() => {
    post({ type: "taskOutput", sessionId, taskId: agent.taskId });
    if (!active) {
      return;
    }
    const timer = setInterval(() => post({ type: "taskOutput", sessionId, taskId: agent.taskId }), 4000);
    return () => clearInterval(timer);
  }, [sessionId, agent.taskId, active, agent.status]);
  const facts = [agent.subagentType, `${agent.toolUses} tool calls`, `${formatTokens(agent.tokens)} tokens`].filter(Boolean).join(" · ");
  return (
    <section class="wf-detail" aria-label="Agent detail">
      <div class="wf-detail-head">
        <span class="wf-detail-title mono">{agent.description || agent.taskId}</span>
        <span class="muted">{facts}</span>
        {active && (
          <button type="button" onClick={() => post({ type: "stopTask", sessionId, taskId: agent.taskId })}>
            Stop agent
          </button>
        )}
      </div>
      <div class="wf-detail-body">
        <div class="muted">Task: {agent.description}</div>
        {agent.lastTool && <div class="muted">Last tool: {agent.lastTool}</div>}
        {agent.summary && <div>{agent.summary}</div>}
        {agent.error && <div class="wf-error">{agent.error}</div>}
        <pre class="wf-output">{output ?? "Loading output..."}</pre>
      </div>
    </section>
  );
}

function WorkflowHeader({ sessionId, workflow }: { sessionId: string; workflow: WorkflowInfo }) {
  const running = workflow.status === "running";
  const elapsed = useElapsed(workflow.durationMs, running);
  return (
    <div class="wf-pane-head">
      <div class="wf-pane-title">
        <span class="wf-pane-name mono">{workflow.name}</span>
        {workflow.description && <span class="muted">{workflow.description}</span>}
      </div>
      <div class="wf-pane-meta muted">
        <span>
          {formatTokens(workflow.tokens)} tokens{workflow.durationMs > 0 ? ` · ${formatDuration(elapsed)}` : ""}
        </span>
        {running && workflow.taskId && (
          <button type="button" onClick={() => post({ type: "stopTask", sessionId, taskId: workflow.taskId! })}>
            Stop workflow
          </button>
        )}
        <button type="button" class="ghost" aria-label="Close workflow pane" onClick={() => setUi(sessionId, { side: "details" })}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function WorkflowPane({ sessionId }: { sessionId: string }) {
  const { messages, ui, taskOutputs } = useSession(sessionId);
  const graph = useMemo(() => taskGraph(messages), [messages]);
  const picked = findWorkflow(graph, ui.workflowTaskId);
  const standaloneFirst = ui.workflowTaskId !== undefined && !picked && graph.standalone.some((agent) => agent.taskId === ui.workflowTaskId);
  const workflow = picked ?? (standaloneFirst ? undefined : defaultWorkflow(graph));
  const agents = workflow ? workflow.agents : graph.standalone;
  const columns = workflow ? workflow.columns : [{ title: "Background agents", declared: false, agents }];
  const selectedId = ui.agentTaskId ?? (standaloneFirst ? ui.workflowTaskId : undefined);
  const selected = agents.find((agent) => agent.taskId === selectedId);

  if (!workflow && agents.length === 0) {
    return (
      <div class="wf-pane">
        <div class="chat-empty">No workflows or background agents yet.</div>
      </div>
    );
  }
  const counts = agentCounts(agents);
  return (
    <div class="wf-pane">
      {workflow ? (
        <WorkflowHeader sessionId={sessionId} workflow={workflow} />
      ) : (
        <div class="wf-pane-head">
          <span class="wf-pane-name">Background agents</span>
          <span class="muted">{counts.running} running</span>
          <button type="button" class="ghost" aria-label="Close workflow pane" onClick={() => setUi(sessionId, { side: "details" })}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      )}
      <div class="wf-columns">
        {columns.map((column, index) => (
          <Column key={column.title} column={column} index={index} selectedId={selectedId} onSelect={(agent) => setUi(sessionId, { agentTaskId: agent.taskId })} />
        ))}
      </div>
      {selected && <AgentDetail sessionId={sessionId} agent={selected} output={taskOutputs[selected.taskId]} />}
    </div>
  );
}
