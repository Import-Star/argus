import { useEffect, useState } from "preact/hooks";
import type { ChatGroup, ChatStatus } from "../../../src/chat/protocol";
import { post, useSession, useStore, type State } from "../store";
import { Composer } from "./Composer";
import { Transcript } from "./Transcript";
import "./grid.css";

const STATUS_TEXT: Record<ChatStatus, string> = {
  starting: "Starting",
  idle: "Idle",
  working: "Working",
  "needs-you": "Needs you",
  ended: "Done",
  error: "Error"
};

const selectIds = (state: State) => state.sessionIds;
const selectRail = (state: State) => state.rail;
const selectStatuses = (state: State) => state.sessionIds.map((id) => state.sessions[id]?.meta?.status ?? "starting").join(",");

function age(since: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - since) / 60_000));
  if (minutes < 1) {
    return "now";
  }
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}

function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function Glyph({ status }: { status: ChatStatus }) {
  if (status === "working" || status === "starting") {
    return <span class="spinner" aria-hidden="true" />;
  }
  return <span class={`grid-dot ${status}`} aria-hidden="true" />;
}

function Icon({ path }: { path: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

function Tile({ sessionId, now }: { sessionId: string; now: number }) {
  const { meta } = useSession(sessionId);
  const rail = useStore(selectRail);
  const status = meta?.status ?? "starting";
  const title = meta?.title || rail.find((entry) => entry.sessionId === sessionId)?.title || "Untitled chat";
  return (
    <section class={`grid-tile${status === "needs-you" ? " needs" : ""}`} aria-label={title}>
      <header class="grid-tile-head">
        <Glyph status={status} />
        <span class="grid-tile-title">{title}</span>
        <span class={`grid-tile-status ${status}`}>
          {STATUS_TEXT[status]}
          {meta ? ` · ${age(meta.statusSince, now)}` : ""}
        </span>
        <button class="ghost grid-icon" aria-label={`Expand ${title}`} title="Expand" onClick={() => post({ type: "grid", action: "expand", sessionId })}>
          <Icon path="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </button>
        <button class="ghost grid-icon" aria-label={`Remove ${title} from grid`} title="Remove from grid" onClick={() => post({ type: "grid", action: "remove", sessionId })}>
          <Icon path="M6 6l12 12M18 6L6 18" />
        </button>
      </header>
      <div class="grid-tile-body">
        <Transcript sessionId={sessionId} compact />
      </div>
      <Composer sessionId={sessionId} compact />
    </section>
  );
}

function AddPicker({ ids }: { ids: string[] }) {
  const [open, setOpen] = useState(false);
  const rail = useStore(selectRail);
  const available = rail.filter((entry) => !ids.includes(entry.sessionId));
  const add = (sessionId: string) => {
    post({ type: "grid", action: "add", sessionId });
    setOpen(false);
  };
  return (
    <div class="grid-add" onKeyDown={(event) => event.key === "Escape" && setOpen(false)}>
      <button class="primary" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>
        Add session
      </button>
      {open && (
        <div class="grid-picker" role="menu" aria-label="Sessions not in the grid">
          {available.length === 0 && <div class="grid-picker-empty muted">Every session is already here.</div>}
          {available.map((entry) => (
            <button key={entry.sessionId} class="ghost grid-picker-item" role="menuitem" onClick={() => add(entry.sessionId)}>
              <span class="grid-picker-title">{entry.title}</span>
              <span class="muted">{entry.repo}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Summary({ ids, group }: { ids: string[]; group: boolean }) {
  const statuses = useStore(selectStatuses);
  const list = statuses ? (statuses.split(",") as ChatStatus[]) : [];
  const needs = list.filter((status) => status === "needs-you").length;
  const working = list.filter((status) => status === "working" || status === "starting").length;
  const quiet = [working ? `${working} working` : "", `${list.length - needs - working} idle`].filter(Boolean).join(" · ");
  return (
    <>
      <span class="grid-count">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        {ids.length} {group ? "agents" : ids.length === 1 ? "session" : "sessions"}
      </span>
      {needs > 0 && <span class="grid-needs">{needs} needs you</span>}
      <span class="muted">{quiet}</span>
    </>
  );
}

const selectGroup = (state: State) => state.groups.find((entry) => entry.id === state.groupId);

function GroupName({ group }: { group: ChatGroup }) {
  return (
    <>
      <span class="grid-group" title={group.title}>
        {group.title}
      </span>
      <button class="grid-add-agent" title="Start another agent in this folder" onClick={() => post({ type: "addAgent", sessionId: group.members[0].sessionId })}>
        + Agent
      </button>
    </>
  );
}

export function Grid() {
  const ids = useStore(selectIds);
  const group = useStore(selectGroup);
  const now = useNow();
  return (
    <div class="chat-grid">
      <header class="grid-bar">
        {group && <GroupName group={group} />}
        <Summary ids={ids} group={Boolean(group)} />
        <AddPicker ids={ids} />
      </header>
      {ids.length === 0 ? (
        <div class="chat-empty">No sessions in the grid. Add one to start.</div>
      ) : (
        <div class="grid-tiles">
          {ids.map((id) => (
            <Tile key={id} sessionId={id} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}
