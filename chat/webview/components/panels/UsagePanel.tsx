import type { Share, UsagePanelData } from "../../../../src/chat/panels/usage";
import { formatDuration } from "../../workflow";
import { formatReset } from "../DetailsPane";
import { formatTokens } from "../Header";
import "./usagePanels.css";

function Shares({ title, rows }: { title: string; rows: Share[] }) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <div class="up-shares">
      <h4>{title}</h4>
      {rows.map((row) => (
        <div key={row.name} class="up-share">
          <span class="up-name">{row.name}</span>
          <div class="up-track"><div style={{ width: `${Math.min(100, row.pct)}%` }} /></div>
          <span class="up-num">{row.pct}%</span>
        </div>
      ))}
    </div>
  );
}

export function UsagePanel({ data }: { sessionId: string; data: UsagePanelData }) {
  const now = Date.now();
  return (
    <>
      <h3 class="up-sub">Plan limits</h3>
      {data.plan === undefined && <p class="cmdp-empty">Plan usage could not be read.</p>}
      {data.plan === null && <p class="cmdp-empty">Plan limits don't apply to this sign-in.</p>}
      {data.plan?.windows.map((window) => (
        <div key={window.key} class="up-window">
          <div class="up-share">
            <span class="up-name">{window.label}</span>
            <div class={`up-track ${window.percent >= 95 ? "danger" : window.percent >= 80 ? "warn" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={window.percent}>
              <div style={{ width: `${window.percent}%` }} />
            </div>
            <span class="up-num">{window.percent}%</span>
          </div>
          {window.resetsAt !== undefined && <div class="muted up-note">{formatReset(window.resetsAt, now)}</div>}
        </div>
      ))}
      {data.session && (
        <>
          <h3 class="up-sub">This session</h3>
          <ul class="up-legend">
            <li><span class="up-name">Cost (estimate)</span><span class="up-num">${data.session.costUsd.toFixed(2)}</span></li>
            <li><span class="up-name">Tokens</span><span class="up-num">{formatTokens(data.session.tokens)}</span></li>
            <li><span class="up-name">Duration</span><span class="up-num">{formatDuration(data.session.durationMs)}</span></li>
          </ul>
        </>
      )}
      {data.periods.map((period) => (
        <section key={period.label}>
          <h3 class="up-sub">What is contributing: {period.label}</h3>
          <p class="muted up-note">{period.requests.toLocaleString()} requests in {period.sessions} sessions on this machine. Shares overlap, so they don't add to 100%.</p>
          <Shares title="Behaviours" rows={period.behaviors} />
          <Shares title="Agents" rows={period.agents} />
          <Shares title="Skills" rows={period.skills} />
        </section>
      ))}
    </>
  );
}
