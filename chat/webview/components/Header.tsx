import { useCallback, useEffect, useState } from "preact/hooks";
import type { ChatGroup, ChatStatus, SDKMessage } from "../../../src/chat/protocol";
import { post, setUi, useSession, useStore, type State } from "../store";
import { Icon } from "./Icon";
import { SideQuestion } from "./SideQuestion";
import "./header.css";

const STATUS_LABELS: Record<ChatStatus, string> = {
  starting: "Starting",
  idle: "Idle",
  working: "Working",
  "needs-you": "Needs you",
  ended: "Ended",
  error: "Error"
};

export function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function formatAge(since: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - since) / 60_000);
  if (minutes < 1) {
    return "<1m";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  return count >= 1000 ? `${Math.round(count / 1000)}k` : String(count);
}

export function prLabel(pr: { key: string; url: string }): string {
  const number = /\/pull\/(\d+)/.exec(pr.url)?.[1];
  return number ? `#${number}` : pr.key;
}

export function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function firstPrompt(messages: SDKMessage[]): string | undefined {
  for (const message of messages) {
    if (message.type !== "user" || message.isSynthetic) {
      continue;
    }
    const content = message.message.content;
    const text = typeof content === "string" ? content : content.find((block) => block.type === "text")?.text;
    if (text?.trim()) {
      return text.trim().split("\n")[0];
    }
  }
  return undefined;
}

function StatusPill({ status, since, error }: { status: ChatStatus; since: number; error?: string }) {
  const now = useNow();
  const glyph = status === "working" || status === "starting" ? <span class="spinner" /> : <span class={`hdr-dot hdr-dot-${status}${status === "needs-you" ? " pulse" : ""}`} />;
  return (
    <span class="hdr-pill" title={error}>
      {glyph}
      {STATUS_LABELS[status]}
      {status !== "starting" && ` · ${formatAge(since, now)}`}
    </span>
  );
}

function ContextMeter({ tokens, max }: { tokens: number; max: number }) {
  const percent = Math.min(100, (tokens / max) * 100);
  const level = percent >= 90 ? "danger" : percent >= 75 ? "warn" : "";
  return (
    <div class="hdr-context">
      <span>Context</span>
      <div class={`hdr-bar ${level}`} role="meter" aria-label="Context used" aria-valuemin={0} aria-valuemax={max} aria-valuenow={tokens}>
        <div style={{ width: `${percent}%` }} />
      </div>
      <span class="hdr-context-count">
        {formatTokens(tokens)} / {formatTokens(max)}
      </span>
    </div>
  );
}

export function formatCacheLeft(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds >= 600) {
    return `${Math.ceil(seconds / 60)}m left`;
  }
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} left`;
}

export function CacheCountdown({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (Date.now() >= expiresAt) {
      return;
    }
    const tick = () => {
      if (!document.hidden) {
        setNow(Date.now());
      }
    };
    const timer = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [expiresAt, now >= expiresAt]);
  const left = expiresAt - now;
  return (
    <div class="det-row" title="Prompt cache expires if idle">
      <span class="muted">Cache</span>
      {left > 0 ? <span>{formatCacheLeft(left)}</span> : <span class="muted">expired</span>}
    </div>
  );
}

const selectMultiAgent = (state: State) => state.multiAgent;

function AgentsChip({ group, sessionId }: { group: ChatGroup; sessionId: string }) {
  const label = `${group.members.length} agents`;
  return (
    <button type="button" class="hdr-agents" title="Open all agents side by side" aria-label={`${label}, open side by side`} onClick={() => post({ type: "openGroup", sessionId })}>
      {label}
      <span class="hdr-agent-dots" aria-hidden="true">
        {group.members.map((member) => (
          <span key={member.sessionId} class={`hdr-dot hdr-dot-${member.status}${member.sessionId === sessionId ? " self" : ""}`} title={`${member.title}: ${STATUS_LABELS[member.status]}`} />
        ))}
      </span>
    </button>
  );
}

export function Header({ sessionId }: { sessionId: string }) {
  const { meta, card, messages, ui } = useSession(sessionId);
  const group = useStore(useCallback((state: State) => state.groups.find((entry) => entry.members.some((member) => member.sessionId === sessionId)), [sessionId]));
  const multiAgent = useStore(selectMultiAgent);
  const title = meta?.title || firstPrompt(messages) || "New chat";
  const pr = card?.prs.find((candidate) => candidate.state.toLowerCase() === "open");
  const reviewing = ui.side === "review";
  return (
    <header class="chat-header">
      <div class="hdr-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <span title={title}>{title}</span>
        <button type="button" class="ghost hdr-icon hdr-rename" aria-label="Rename chat" title="Rename chat" onClick={() => post({ type: "rename", sessionId })}>
          <Icon d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />
        </button>
      </div>
      {meta && <StatusPill status={meta.status} since={meta.statusSince} error={meta.error} />}
      {meta?.branch && <span class="mono muted">{meta.branch}</span>}
      {card?.worktree && (
        <span class="mono muted" title={card.worktree}>
          {basename(card.worktree)}
        </span>
      )}
      {pr && (
        <button type="button" class="hdr-pr" title={pr.title} onClick={() => post({ type: "openUrl", url: pr.url })}>
          PR {prLabel(pr)} open
        </button>
      )}
      {group && multiAgent && <AgentsChip group={group} sessionId={sessionId} />}
      {meta?.remoteControlUrl && (
        <button type="button" class="hdr-pr" title="Remote Control is on: open this chat on claude.ai. /remote-control off stops it." onClick={() => post({ type: "openUrl", url: meta.remoteControlUrl! })}>
          Remote Control
        </button>
      )}
      {meta?.chrome && (
        <span class="mono muted" title="Claude in Chrome is on: Claude can control your browser. /chrome off turns it off.">
          Chrome
        </span>
      )}
      <div class="hdr-end">
        {meta?.contextTokens !== undefined && meta.contextMax ? <ContextMeter tokens={meta.contextTokens} max={meta.contextMax} /> : null}
        <SideQuestion sessionId={sessionId} />
        <button
          type="button"
          class="ghost hdr-icon"
          aria-pressed={reviewing}
          aria-label={reviewing ? "Close review" : "Review changes"}
          title={reviewing ? "Close review" : "Review changes"}
          onClick={() => setUi(sessionId, { side: reviewing ? "details" : "review" })}
        >
          <Icon d="M6 3v12M18 9v12M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 9h6l-2-2M18 15h-6l2 2" />
        </button>
        {multiAgent && (
          <button type="button" class="ghost hdr-icon" aria-label="Add agent" title="Add agent: start another agent in this folder" onClick={() => post({ type: "addAgent", sessionId })}>
            <Icon d="M12 5v14M5 12h14" />
          </button>
        )}
        <button type="button" class="ghost hdr-icon" aria-label="Archive" title="Archive: like archiving its board card" onClick={() => post({ type: "archive", sessionId })}>
          <Icon d="M3 7h18M5 7v12h14V7M9 11h6M4 4h16v3H4z" />
        </button>
      </div>
    </header>
  );
}
