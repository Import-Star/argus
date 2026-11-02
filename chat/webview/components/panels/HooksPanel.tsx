import type { HooksPanelData } from "../../../../src/chat/panels/hooks";
import { panelAction } from "./CommandPanel";
import "./settingsPanels.css";

export function HooksPanel({ sessionId, data }: { sessionId: string; data: HooksPanelData }) {
  const open = (file: string, event?: string) => panelAction(sessionId, "hooks", "open", { file, event });
  return (
    <div>
      {data.files.map((entry) => entry.error && <p class="setp-error">{entry.label}: {entry.error}</p>)}
      {data.groups.length === 0 && <p class="cmdp-empty">No hooks set in your settings files.</p>}
      {data.groups.map((group) => (
        <section>
          <h3 class="setp-h">{group.event}</h3>
          {group.matchers.map((entry) => (
            <div>
              <div class="setp-note">{entry.matcher || "All tools"}</div>
              {entry.hooks.map((hook) => (
                <div class="setp-row">
                  <span class="setp-text">{hook.command}<br /><span class="setp-src">{hook.type}{hook.timeout !== undefined && ` · ${hook.timeout}s timeout`}</span></span>
                  <span class="setp-src">{hook.label}</span>
                  <button type="button" class="cmdp-btn" onClick={() => open(hook.file, group.event)}>Open file</button>
                </div>
              ))}
            </div>
          ))}
        </section>
      ))}
      <p class="setp-note">Read-only. Hooks from plugins and managed settings are not listed.</p>
      <h3 class="setp-h">Files</h3>
      {data.files.map((entry) => (
        <div class="setp-row">
          <span class="setp-text">{entry.label}<br /><span class="setp-src">{entry.file}</span></span>
          {entry.exists ? <button type="button" class="cmdp-btn" onClick={() => open(entry.file)}>Open file</button> : <span class="setp-src">not created yet</span>}
        </div>
      ))}
    </div>
  );
}
