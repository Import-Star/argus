import { useEffect, useMemo, useState } from "preact/hooks";
import type { CardInfo, ChangeScope, PlanUsageWindow, PluginItem, SDKMessage } from "../../../src/chat/protocol";
import { backgroundTasks, type BackgroundTask } from "../backgroundTasks";
import { sessionArtifacts } from "../sessionArtifacts";
import { sessionFiles } from "../sessionFiles";
import { post, setUi, useSession } from "../store";
import { formatDuration } from "../workflow";
import { CacheCountdown, formatTokens, prLabel } from "./Header";
import "./details.css";

interface AgentRun {
  id: string;
  name: string;
  description?: string;
  state: "running" | "done" | "failed";
}

const FAILED_CONCLUSIONS = ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"];
const USAGE_REFRESH_MS = 5 * 60_000;
const OUTPUT_REFRESH_MS = 4000;
const DAY_MS = 24 * 60 * 60_000;
const REVIEW_LABELS: Record<string, string> = { APPROVED: "Approved", CHANGES_REQUESTED: "Changes requested", REVIEW_REQUIRED: "Review required" };

function agentRuns(messages: SDKMessage[]): AgentRun[] {
  const runs = new Map<string, AgentRun>();
  for (const message of messages) {
    if (message.type !== "assistant" && message.type !== "user") {
      continue;
    }
    const content = message.message.content;
    if (typeof content === "string") {
      continue;
    }
    for (const block of content) {
      if (block.type === "tool_use" && (block.name === "Agent" || block.name === "Task")) {
        const input = block.input as { subagent_type?: string; description?: string };
        runs.set(block.id, { id: block.id, name: input.subagent_type ?? "agent", description: input.description, state: "running" });
      } else if (block.type === "tool_result") {
        const run = runs.get(block.tool_use_id);
        if (run) {
          run.state = block.is_error ? "failed" : "done";
        }
      }
    }
  }
  return [...runs.values()];
}

function checksSummary(pr: CardInfo["prs"][number]): string | undefined {
  const failed = pr.checks.filter((check) => FAILED_CONCLUSIONS.includes(check.conclusion ?? "")).length;
  const pending = pr.checks.filter((check) => !check.conclusion && check.status !== "COMPLETED").length;
  const checks = !pr.checks.length ? undefined : failed ? `${failed} ${failed === 1 ? "check" : "checks"} failing` : pending ? "Checks running" : "Checks passing";
  return [checks, pr.reviewDecision && REVIEW_LABELS[pr.reviewDecision]].filter(Boolean).join(" · ") || undefined;
}

function useNow(active: boolean, intervalMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) {
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}

function usePlanUsage(sessionId: string, busy: boolean, applies: boolean): void {
  useEffect(() => {
    if (!applies) {
      return;
    }
    const refresh = () => {
      if (!document.hidden) {
        post({ type: "usage", sessionId });
      }
    };
    const timer = setInterval(refresh, USAGE_REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [sessionId, applies]);
  useEffect(() => {
    if (applies && !document.hidden) {
      post({ type: "usage", sessionId });
    }
  }, [sessionId, busy, applies]);
}

function formatReset(resetsAt: number, now: number): string {
  const left = resetsAt - now;
  if (left <= 0) {
    return "Resetting";
  }
  if (left >= DAY_MS) {
    return `Resets ${new Date(resetsAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
  }
  const minutes = Math.ceil(left / 60_000);
  return minutes < 60 ? `Resets in ${minutes}m` : `Resets in ${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function UsageWindow({ limit }: { limit: PlanUsageWindow }) {
  const now = useNow(limit.resetsAt !== undefined, 60_000);
  const level = limit.percent >= 95 ? "danger" : limit.percent >= 80 ? "warn" : "";
  return (
    <div class="det-limit">
      <div class="det-row">
        <span class="muted">{limit.label}</span>
        <span>{limit.percent}% used</span>
      </div>
      <div class={`det-meter ${level}`} role="progressbar" aria-label={`${limit.label} plan usage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={limit.percent}>
        <div style={{ width: `${limit.percent}%` }} />
      </div>
      {limit.resetsAt !== undefined && <div class="muted det-note">{formatReset(limit.resetsAt, now)}</div>}
    </div>
  );
}

function TaskIcon({ state }: { state: BackgroundTask["state"] }) {
  if (state === "running") {
    return <span class="spinner" role="img" aria-label="running" />;
  }
  const path = state === "done" ? "M5 12l5 5L20 7" : state === "failed" ? "M6 6l12 12M18 6L6 18" : "M5 12h14";
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={state === "failed" ? "var(--danger)" : state === "done" ? "var(--green)" : "var(--muted)"} stroke-width="3" role="img" aria-label={state}>
      <path d={path} />
    </svg>
  );
}

function TaskOutput({ sessionId, taskId, running, output }: { sessionId: string; taskId: string; running: boolean; output?: string }) {
  useEffect(() => {
    post({ type: "taskOutput", sessionId, taskId });
    if (!running) {
      return;
    }
    const timer = setInterval(() => post({ type: "taskOutput", sessionId, taskId }), OUTPUT_REFRESH_MS);
    return () => clearInterval(timer);
  }, [sessionId, taskId, running]);
  return <pre class="det-bg-output mono">{output ?? "Loading output..."}</pre>;
}

function BackgroundRow({ sessionId, task, output }: { sessionId: string; task: BackgroundTask; output?: string }) {
  const [open, setOpen] = useState(false);
  const running = task.state === "running";
  const now = useNow(running, 1000);
  const elapsed = formatDuration(Math.max(0, (task.endedAt ?? now) - task.startedAt));
  return (
    <div class="det-bg">
      <div class="det-agent" title={task.description}>
        <TaskIcon state={task.state} />
        <span class="det-agent-name">{task.description || task.id}</span>
        <span class="muted det-note">{elapsed}</span>
      </div>
      <div class="det-bg-actions">
        <span class="det-chip">{task.agentType ?? task.label}</span>
        {task.kind === "local_workflow" ? (
          <button type="button" class="det-diff" onClick={() => setUi(sessionId, { side: "workflow", workflowTaskId: task.id, agentTaskId: undefined })}>
            View
          </button>
        ) : (
          <button type="button" class="det-diff" aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} output of ${task.description || task.id}`} onClick={() => setOpen(!open)}>
            Output
          </button>
        )}
        {running && (
          <button type="button" class="det-diff" aria-label={`Stop ${task.description || task.id}`} onClick={() => post({ type: "stopTask", sessionId, taskId: task.id })}>
            Stop
          </button>
        )}
      </div>
      {open && <TaskOutput sessionId={sessionId} taskId={task.id} running={running} output={output} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <section class="det-section">
      <h2 class="section-label">{title}</h2>
      {children}
    </section>
  );
}

// Starts closed; the browser keeps it open or closed across re-renders since `open` isn't a prop.
function FoldedSection({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <details class="det-section det-fold">
      <summary class="section-label">{title}</summary>
      {children}
    </details>
  );
}

function isFinishedPr(pr: { state: string }): boolean {
  return pr.state === "MERGED" || pr.state === "CLOSED";
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div class="det-row">
      <span class="muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}

// A section a plugin added (ArgusApi.registerChatDetails): plain data, drawn here.
function PluginSection({ sessionId, section }: { sessionId: string; section: NonNullable<CardInfo["plugins"]>[number] }) {
  const act = (item: { id: string }, value?: string) => post({ type: "pluginAction", sessionId, key: section.key, itemId: item.id, value });
  const draw = (item: PluginItem, index: number) => {
    switch (item.type) {
      case "row":
        return (
          <div class="det-row" key={index} title={item.tooltip}>
            <span class="muted">{item.label}</span>
            <span>{item.value}</span>
          </div>
        );
      case "note":
        return (
          <div class="muted det-note" key={index}>
            {item.text}
          </div>
        );
      case "select":
        return (
          <div class="det-row det-select" key={item.id}>
            <span class="muted">{item.label}</span>
            <label class="det-pick">
              <span class="det-pick-text">{item.options.find((option) => option.value === item.value)?.label ?? item.value}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            <select aria-label={item.label} value={item.value} onChange={(event) => act(item, event.currentTarget.value)}>
              {item.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            </label>
          </div>
        );
      case "button":
        return (
          <button type="button" class="det-diff" key={item.id} onClick={() => act(item)}>
            {item.label}
          </button>
        );
    }
  };
  return <Section title={section.title}>{section.items.map(draw)}</Section>;
}

function openReview(sessionId: string, scope: ChangeScope, file?: string): void {
  setUi(sessionId, { side: "review", reviewScope: scope, reviewFile: file, worktree: undefined });
}

function DiffButton({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button type="button" class="det-diff" aria-label={label} onClick={onClick}>
      Diff
    </button>
  );
}

export function DetailsPane({ sessionId }: { sessionId: string }) {
  const { meta, card, messages, changes, ui, usage, taskOutputs } = useSession(sessionId);
  const background = useMemo(() => backgroundTasks(messages), [messages]);
  const agents = useMemo(() => {
    const tracked = new Set(background.map((task) => task.toolUseId));
    return agentRuns(messages).filter((run) => !tracked.has(run.id));
  }, [messages, background]);
  const [showDone, setShowDone] = useState(false);
  const [showDoneBackground, setShowDoneBackground] = useState(false);
  const [showClosedPrs, setShowClosedPrs] = useState(false);
  const doneCount = agents.filter((agent) => agent.state === "done").length;
  const edited = useMemo(() => sessionFiles(messages, meta?.cwd), [messages, meta?.cwd]);
  const artifacts = useMemo(() => sessionArtifacts(messages), [messages]);
  const stats = changes?.scope === "session" ? changes.files : [];
  const status = meta?.status;
  const prs = card?.prs ?? [];
  const finishedPrs = prs.filter(isFinishedPr).length;
  const worktrees = card?.worktrees ?? [];
  const cacheExpiresAt = meta?.lastResponseAt !== undefined && meta.cacheTtlMs ? meta.lastResponseAt + meta.cacheTtlMs : undefined;
  const limits = usage?.windows ?? [];
  const runningTasks = background.filter((task) => task.state === "running");
  const finishedTasks = background.filter((task) => task.state !== "running");
  const hasUsage = limits.length > 0 || card?.usedTokens !== undefined || card?.compactions !== undefined || meta?.contextTokens !== undefined || cacheExpiresAt !== undefined;

  usePlanUsage(sessionId, status === "working" || status === "needs-you", usage !== null);

  useEffect(() => {
    if (ui.side === "details" && edited.length > 0) {
      post({ type: "changes", sessionId, scope: "session", files: edited });
    }
  }, [sessionId, ui.side, status, edited.join("\n")]);

  return (
    <div class="det" role="region" aria-label="Session details">
      {edited.length > 0 && (
        <FoldedSection title={`Changed files · ${edited.length}`}>
          {changes?.scope === "session" && changes.error && <div class="det-error">{changes.error}</div>}
          {edited.map((file) => {
            const stat = stats.find((entry) => file === entry.path || file.endsWith(`/${entry.path}`) || entry.path.endsWith(`/${file}`));
            return (
              <button type="button" class="ghost det-file mono" key={file} title={file} onClick={() => openReview(sessionId, "session", stat?.path)}>
                <span class="det-path">{file}</span>
                {stat && <span class="det-add">+{stat.added}</span>}
                {stat && <span class="det-del">−{stat.removed}</span>}
              </button>
            );
          })}
        </FoldedSection>
      )}
      {artifacts.length > 0 && (
        <Section title={`Artifacts · ${artifacts.length}`}>
          {artifacts.map((artifact) => (
            <button type="button" class="ghost det-file" key={artifact.url} title={artifact.url} onClick={() => post({ type: "openUrl", url: artifact.url })}>
              <span class="det-path">{artifact.title}</span>
              <span class="det-id mono">{artifact.id.slice(0, 6)}</span>
            </button>
          ))}
        </Section>
      )}
      {(card?.plugins ?? []).map((section) => (
        <PluginSection key={section.key} sessionId={sessionId} section={section} />
      ))}
      {worktrees.length > 0 && (
        <Section title={worktrees.length > 1 ? `Worktrees · ${worktrees.length}` : "Worktree"}>
          {worktrees.map((tree) => (
            <div key={tree.path}>
              <div class="det-head">
                <div class="mono det-grow" title={tree.path}>
                  {tree.name}
                  {tree.branch && <span class="muted"> · {tree.branch}</span>}
                </div>
                <DiffButton label={`Diff of worktree ${tree.name} against main`} onClick={() => setUi(sessionId, { side: "review", reviewScope: "base", worktree: tree.path, prUrl: undefined, reviewFile: undefined })} />
              </div>
              <div class="muted det-note det-wrap">{tree.path}</div>
            </div>
          ))}
        </Section>
      )}
      {prs.length > 0 && (
        <Section title="Pull requests">
          {prs.filter((pr) => showClosedPrs || !isFinishedPr(pr)).map((pr) => (
            <div class="det-pr" key={pr.key}>
              <div class="det-head">
                <button type="button" class="ghost det-link det-grow" onClick={() => post({ type: "openUrl", url: pr.url })}>
                  <span class={`det-chip det-chip-${pr.isDraft ? "draft" : pr.state.toLowerCase()}`}>{pr.isDraft ? "draft" : pr.state.toLowerCase()}</span>
                  <span>
                    {prLabel(pr)}
                    {pr.title ? ` ${pr.title}` : ""}
                  </span>
                </button>
                <DiffButton label={`Diff of ${prLabel(pr)}`} onClick={() => setUi(sessionId, { side: "review", reviewScope: "pr", prUrl: pr.url, worktree: undefined, reviewFile: undefined })} />
              </div>
              <div class="muted det-note">{checksSummary(pr)}</div>
            </div>
          ))}
          {finishedPrs > 0 && (
            <button type="button" class="det-done-toggle" aria-expanded={showClosedPrs} onClick={() => setShowClosedPrs(!showClosedPrs)}>
              {showClosedPrs ? "Hide" : "Show"} {finishedPrs} merged / closed
            </button>
          )}
        </Section>
      )}
      {agents.length > 0 && (
        <Section title="Agents">
          {agents.filter((agent) => showDone || agent.state !== "done").map((agent) => (
            <div class="det-agent" key={agent.id} title={agent.description}>
              {agent.state === "running" ? (
                <span class="spinner" />
              ) : (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={agent.state === "done" ? "var(--green)" : "var(--danger)"} stroke-width="3" aria-hidden="true">
                  <path d={agent.state === "done" ? "M5 12l5 5L20 7" : "M6 6l12 12M18 6L6 18"} />
                </svg>
              )}
              <span class="det-agent-name">{agent.name}</span>
              <span class="muted det-note">{agent.state}</span>
            </div>
          ))}
          {doneCount > 0 && (
            <button type="button" class="det-done-toggle" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
              {showDone ? "Hide" : "Show"} {doneCount} done
            </button>
          )}
        </Section>
      )}
      {background.length > 0 && (
        <Section title={runningTasks.length > 0 ? `Background · ${runningTasks.length} running` : "Background"}>
          {[...runningTasks, ...(showDoneBackground ? finishedTasks : [])].map((task) => (
            <BackgroundRow key={task.id} sessionId={sessionId} task={task} output={taskOutputs[task.id]} />
          ))}
          {finishedTasks.length > 0 && (
            <button type="button" class="det-done-toggle" aria-expanded={showDoneBackground} onClick={() => setShowDoneBackground(!showDoneBackground)}>
              {showDoneBackground ? "Hide" : "Show"} {finishedTasks.length} finished
            </button>
          )}
        </Section>
      )}
      {hasUsage && (
        <Section title="Usage">
          {limits.map((limit) => (
            <UsageWindow key={limit.key} limit={limit} />
          ))}
          {cacheExpiresAt !== undefined && <CacheCountdown expiresAt={cacheExpiresAt} />}
          {card?.usedTokens !== undefined && <Row label="Tokens this session" value={formatTokens(card.usedTokens)} />}
          {meta?.contextTokens !== undefined && <Row label="Context" value={meta.contextMax ? `${formatTokens(meta.contextTokens)} / ${formatTokens(meta.contextMax)}` : formatTokens(meta.contextTokens)} />}
          {card?.compactions !== undefined && <Row label="Compacted" value={`${card.compactions} ${card.compactions === 1 ? "time" : "times"}`} />}
        </Section>
      )}
    </div>
  );
}
