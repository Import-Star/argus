import { useEffect, useMemo, useState } from "preact/hooks";
import type { CardInfo, ChangeScope, SDKMessage } from "../../../src/chat/protocol";
import { sessionArtifacts } from "../sessionArtifacts";
import { sessionFiles } from "../sessionFiles";
import { post, setUi, useSession } from "../store";
import { basename, CacheCountdown, formatTokens, prLabel } from "./Header";
import "./details.css";

interface AgentRun {
  id: string;
  name: string;
  description?: string;
  state: "running" | "done" | "failed";
}

const FAILED_CONCLUSIONS = ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"];
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

function Section({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <section class="det-section">
      <h2 class="section-label">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div class="det-row">
      <span class="muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function openReview(sessionId: string, scope: ChangeScope, file?: string): void {
  setUi(sessionId, { side: "review", reviewScope: scope, reviewFile: file });
}

function DiffButton({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button type="button" class="det-diff" aria-label={label} onClick={onClick}>
      Diff
    </button>
  );
}

export function DetailsPane({ sessionId }: { sessionId: string }) {
  const { meta, card, messages, changes, ui } = useSession(sessionId);
  const agents = useMemo(() => agentRuns(messages), [messages]);
  const [showDone, setShowDone] = useState(false);
  const doneCount = agents.filter((agent) => agent.state === "done").length;
  const edited = useMemo(() => sessionFiles(messages, meta?.cwd), [messages, meta?.cwd]);
  const artifacts = useMemo(() => sessionArtifacts(messages), [messages]);
  const stats = changes?.scope === "session" ? changes.files : [];
  const status = meta?.status;
  const prs = card?.prs ?? [];
  const cacheExpiresAt = meta?.lastResponseAt !== undefined && meta.cacheTtlMs ? meta.lastResponseAt + meta.cacheTtlMs : undefined;
  const hasUsage = card?.usedTokens !== undefined || card?.compactions !== undefined || meta?.contextTokens !== undefined || cacheExpiresAt !== undefined;

  useEffect(() => {
    if (ui.side === "details" && edited.length > 0) {
      post({ type: "changes", sessionId, scope: "session", files: edited });
    }
  }, [sessionId, ui.side, status, edited.join("\n")]);

  return (
    <div class="det" role="region" aria-label="Session details">
      {edited.length > 0 && (
        <Section title={`Changed files · ${edited.length}`}>
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
        </Section>
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
      {card?.worktree && (
        <Section title="Worktree">
          <div class="det-head">
            <div class="mono det-grow" title={card.worktree}>
              {basename(card.worktree)}
            </div>
            <DiffButton label="Diff of worktree against main" onClick={() => openReview(sessionId, "base")} />
          </div>
          <div class="muted det-note det-wrap">{card.worktree}</div>
        </Section>
      )}
      {prs.length > 0 && (
        <Section title="Pull requests">
          {prs.map((pr) => (
            <div class="det-pr" key={pr.key}>
              <div class="det-head">
                <button type="button" class="ghost det-link det-grow" onClick={() => post({ type: "openUrl", url: pr.url })}>
                  <span class={`det-chip det-chip-${pr.isDraft ? "draft" : pr.state.toLowerCase()}`}>{pr.isDraft ? "draft" : pr.state.toLowerCase()}</span>
                  <span>
                    {prLabel(pr)}
                    {pr.title ? ` ${pr.title}` : ""}
                  </span>
                </button>
                <DiffButton label={`Diff of ${prLabel(pr)}`} onClick={() => setUi(sessionId, { side: "review", reviewScope: "pr", prUrl: pr.url, reviewFile: undefined })} />
              </div>
              <div class="muted det-note">{checksSummary(pr)}</div>
            </div>
          ))}
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
      {hasUsage && (
        <Section title="Usage">
          {cacheExpiresAt !== undefined && <CacheCountdown expiresAt={cacheExpiresAt} />}
          {card?.usedTokens !== undefined && <Row label="Tokens this session" value={formatTokens(card.usedTokens)} />}
          {meta?.contextTokens !== undefined && <Row label="Context" value={meta.contextMax ? `${formatTokens(meta.contextTokens)} / ${formatTokens(meta.contextMax)}` : formatTokens(meta.contextTokens)} />}
          {card?.compactions !== undefined && <Row label="Compacted" value={`${card.compactions} ${card.compactions === 1 ? "time" : "times"}`} />}
        </Section>
      )}
    </div>
  );
}
