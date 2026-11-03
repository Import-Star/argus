import { useEffect, useState } from "preact/hooks";
import type { ChatStatus } from "../../../src/chat/protocol";
import { post, useSession, useStore, type State } from "../store";
import { AddAgent } from "./AddAgent";
import { Composer } from "./Composer";
import { ReviewPane } from "./ReviewPane";
import { SidePane } from "./SidePane";
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

function Tile({ sessionId, now, focused, selected, onFocus, onSelect }: { sessionId: string; now: number; focused: boolean; selected: boolean; onFocus: () => void; onSelect: () => void }) {
  const { meta } = useSession(sessionId);
  const status = meta?.status ?? "starting";
  const title = useTitle(sessionId);
  return (
    <section class={`grid-tile${status === "needs-you" ? " needs" : ""}${selected ? " selected" : ""}`} aria-label={title} onPointerDown={onSelect} onFocusIn={onSelect}>
      <header class="grid-tile-head">
        <Glyph status={status} />
        <span class="grid-tile-title">{title}</span>
        <span class={`grid-tile-status ${status}`}>
          {STATUS_TEXT[status]}
          {meta ? ` · ${age(meta.statusSince, now)}` : ""}
        </span>
        <button class="ghost grid-icon" aria-pressed={focused} aria-label={`${focused ? "Back to all agents" : "Focus"} ${title}`} title={focused ? "Back to all agents" : "Focus: fill the tab with this agent"} onClick={onFocus}>
          <Icon path={focused ? "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" : "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"} />
        </button>
        <button class="ghost grid-icon" aria-label={`Pop out ${title}`} title="Pop out to its own tab" onClick={() => post({ type: "grid", action: "remove", sessionId })}>
          <Icon path="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />
        </button>
        <button class="ghost grid-icon" aria-label={`Archive ${title}`} title="Archive: like archiving its board card" onClick={() => post({ type: "archive", sessionId })}>
          <Icon path="M3 7h18M5 7v12h14V7M9 11h6M4 4h16v3H4z" />
        </button>
      </header>
      <div class="grid-tile-body">
        <Transcript sessionId={sessionId} compact={!focused} />
      </div>
      <Composer sessionId={sessionId} compact={!focused} />
    </section>
  );
}

function Summary({ ids, group }: { ids: string[]; group: boolean }) {
  const statuses = useStore(selectStatuses);
  const list = statuses ? (statuses.split(",") as ChatStatus[]) : [];
  const needs = list.filter((status) => status === "needs-you").length;
  const working = list.filter((status) => status === "working" || status === "starting").length;
  const done = list.filter((status) => status === "ended" || status === "error").length;
  const idle = list.length - needs - working - done;
  const quiet = [working && `${working} working`, idle && `${idle} idle`, done && `${done} done`].filter(Boolean).join(" · ");
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

function useTitle(sessionId: string): string {
  const { meta } = useSession(sessionId);
  const rail = useStore(selectRail);
  return meta?.title || rail.find((entry) => entry.sessionId === sessionId)?.title || "Untitled chat";
}

function AgentTab({ sessionId, selected, onSelect }: { sessionId: string; selected: boolean; onSelect: () => void }) {
  const { meta } = useSession(sessionId);
  const title = useTitle(sessionId);
  return (
    <button type="button" class="grid-side-tab" aria-pressed={selected} title={title} onClick={onSelect}>
      <Glyph status={meta?.status ?? "starting"} />
      <span>{title}</span>
    </button>
  );
}

// The details panel of one agent at a time: the selected tile's, or the focused one's.
function AgentSide({ ids, sessionId, onSelect }: { ids: string[]; sessionId: string; onSelect: (id: string) => void }) {
  const { ui } = useSession(sessionId);
  return (
    <>
      <aside class="chat-side grid-side" aria-label="Agent details">
        {ids.length > 1 && (
          <div class="grid-side-tabs">
            {ids.map((id) => (
              <AgentTab key={id} sessionId={id} selected={id === sessionId} onSelect={() => onSelect(id)} />
            ))}
          </div>
        )}
        <SidePane sessionId={sessionId} />
      </aside>
      {ui.side === "review" && <ReviewPane sessionId={sessionId} />}
    </>
  );
}

const selectGroup = (state: State) => state.groups.find((entry) => entry.id === state.groupId);

export function Grid() {
  const ids = useStore(selectIds);
  const group = useStore(selectGroup);
  const now = useNow();
  const [focus, setFocus] = useState<string>();
  const [picked, setPicked] = useState<string>();
  const [panel, setPanel] = useState(true);
  const shown = focus && ids.includes(focus) ? [focus] : ids;
  const selected = shown.length === 1 ? shown[0] : picked && ids.includes(picked) ? picked : ids[0];
  const showSide = Boolean(selected) && (panel || shown.length === 1);
  return (
    <div class="chat-grid">
      <header class="grid-bar">
        {group && (
          <span class="grid-group" title={group.title}>
            {group.title}
          </span>
        )}
        <Summary ids={ids} group={Boolean(group)} />
        <span class="grid-bar-end">
          <button type="button" class="ghost hdr-icon" aria-pressed={showSide} aria-label="Agent details" title={showSide ? "Hide agent details" : "Show agent details"} onClick={() => setPanel(!showSide)}>
            <Icon path="M4 4h16v16H4zM15 4v16" />
          </button>
          <AddAgent exclude={ids} newFrom={group?.members[0].sessionId} />
        </span>
      </header>
      {ids.length === 0 ? (
        <div class="chat-empty">No sessions in the grid. Add one to start.</div>
      ) : (
        <div class="grid-body">
          <div class="grid-tiles">
            {shown.map((id) => (
              <Tile
                key={id}
                sessionId={id}
                now={now}
                focused={shown.length === 1 && id === focus}
                selected={showSide && shown.length > 1 && id === selected}
                onFocus={() => setFocus(focus === id ? undefined : id)}
                onSelect={() => setPicked(id)}
              />
            ))}
          </div>
          {showSide && selected && <AgentSide ids={ids} sessionId={selected} onSelect={(id) => (focus ? setFocus(id) : setPicked(id))} />}
        </div>
      )}
    </div>
  );
}
