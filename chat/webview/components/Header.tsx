import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { ChatGroup, ChatStatus, SDKMessage } from "../../../src/chat/protocol";
import { post, setUi, useSession, useStore, type State } from "../store";
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

interface MenuItem {
  label: string;
  title?: string;
  checked?: boolean;
  onSelect: () => void;
}

function MoreMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    root.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const away = (event: MouseEvent) => !root.current?.contains(event.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    const entries = [...(root.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    if (step && entries.length) {
      event.preventDefault();
      const at = entries.indexOf(document.activeElement as HTMLElement);
      entries[(at + step + entries.length) % entries.length].focus();
    }
  };

  return (
    <div class="hdr-more" ref={root} onKeyDown={onKeyDown}>
      <button ref={trigger} type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} title="More actions" onClick={() => setOpen(!open)}>
        ⋯
      </button>
      {open && (
        <div class="hdr-menu" role="menu" aria-label="More actions">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={item.checked}
              title={item.title}
              onClick={() => {
                item.onSelect();
                close();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Header({ sessionId }: { sessionId: string }) {
  const { meta, card, messages, ui } = useSession(sessionId);
  const group = useStore(useCallback((state: State) => state.groups.find((entry) => entry.members.some((member) => member.sessionId === sessionId)), [sessionId]));
  const title = meta?.title || firstPrompt(messages) || "New chat";
  const pr = card?.prs.find((candidate) => candidate.state.toLowerCase() === "open");
  const reviewing = ui.side === "review";
  const previewing = ui.side === "preview";
  return (
    <header class="chat-header">
      <div class="hdr-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <span title={title}>{title}</span>
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
      {group && <AgentsChip group={group} sessionId={sessionId} />}
      <div class="hdr-end">
        {meta?.contextTokens !== undefined && meta.contextMax ? <ContextMeter tokens={meta.contextTokens} max={meta.contextMax} /> : null}
        <SideQuestion sessionId={sessionId} />
        <button type="button" aria-pressed={reviewing} onClick={() => setUi(sessionId, { side: reviewing ? "details" : "review" })}>
          {reviewing ? "Close review" : "Review changes"}
        </button>
        <MoreMenu
          items={[
            { label: "+ Agent", title: "Start another agent in this folder", onSelect: () => post({ type: "addAgent", sessionId }) },
            { label: "Preview", checked: previewing, onSelect: () => setUi(sessionId, { side: previewing ? "details" : "preview" }) },
            { label: "Archive", title: "Archive this agent, like archiving its board card", onSelect: () => post({ type: "archive", sessionId }) }
          ]}
        />
      </div>
    </header>
  );
}
