import type { LoopsPanelData } from "../../../../src/chat/panels/loops";
import { describeCron, type LoopRow } from "../../../../src/chat/loops";
import { panelAction } from "./CommandPanel";
import "./loops.css";

function Row({ sessionId, loop }: { sessionId: string; loop: LoopRow }) {
  return (
    <li class="loops-row">
      <div class="loops-meta">
        <strong>{describeCron(loop.schedule)}</strong>
        <span class="loops-muted">{loop.recurring ? "recurring" : "one-shot"} · {loop.schedule} · {loop.id}</span>
      </div>
      <p class="loops-prompt" title={loop.prompt}>{loop.prompt}</p>
      <button type="button" class="cmdp-btn" onClick={() => panelAction(sessionId, "loops", "delete", loop.id)}>Delete</button>
    </li>
  );
}

export function LoopsPanel({ sessionId, data }: { sessionId: string; data: LoopsPanelData }) {
  return (
    <div>
      <button type="button" class="cmdp-btn" onClick={() => panelAction(sessionId, "loops", "new")}>New loop</button>
      <h3 class="loops-title">Saved in this folder</h3>
      {data.durable.length === 0 ? <p class="cmdp-empty">None.</p> : <ul class="loops-list">{data.durable.map((loop) => <Row key={loop.id} sessionId={sessionId} loop={loop} />)}</ul>}
      <h3 class="loops-title">This chat only</h3>
      {data.session === undefined ? (
        <p class="cmdp-empty">Unknown until Claude finishes its first turn.</p>
      ) : data.session.length === 0 ? (
        <p class="cmdp-empty">None.</p>
      ) : (
        <ul class="loops-list">{data.session.map((loop) => <Row key={loop.id} sessionId={sessionId} loop={loop} />)}</ul>
      )}
      <p class="loops-muted">Claude has no direct delete call, so Delete asks Claude in this chat.</p>
    </div>
  );
}
