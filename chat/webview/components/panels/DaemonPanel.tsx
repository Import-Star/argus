import type { DaemonPanelData } from "../../../../src/chat/panels/daemon";
import { panelAction } from "./CommandPanel";
import "./daemon.css";

export function DaemonPanel({ sessionId, data }: { sessionId: string; data: DaemonPanelData }) {
  const act = (action: string) => () => panelAction(sessionId, "daemon", action);
  return (
    <div>
      <p class="daemon-state">
        <span class={`daemon-dot ${data.status.running ? "on" : ""}`} />
        {data.status.running ? "Running" : "Not running"}
      </p>
      {data.status.fields.length > 0 && (
        <dl class="daemon-fields">
          {data.status.fields.map((field) => (
            <>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </>
          ))}
        </dl>
      )}
      <pre class="daemon-raw">{data.raw}</pre>
      <div class="daemon-actions">
        <button type="button" class="cmdp-btn" onClick={act("stop")}>Stop</button>
        <button type="button" class="cmdp-btn" onClick={act("logs")}>Logs</button>
        {data.configFile && <button type="button" class="cmdp-btn" onClick={act("open-config")}>Open config</button>}
      </div>
      {data.configFile && (
        <>
          <h3 class="daemon-title">Configured</h3>
          {data.config.length === 0 ? (
            <p class="cmdp-empty">Nothing to summarise.</p>
          ) : (
            <dl class="daemon-fields">
              {data.config.map((row) => (
                <>
                  <dt>{row.key}</dt>
                  <dd>{row.value}</dd>
                </>
              ))}
            </dl>
          )}
        </>
      )}
    </div>
  );
}
