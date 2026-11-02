import { useState } from "preact/hooks";
import { RULE_LISTS, type PermissionsPanelData, type RuleList } from "../../../../src/chat/panels/permissions";
import { panelAction } from "./CommandPanel";
import "./settingsPanels.css";

const TABS: Record<RuleList, string> = { allow: "Allow", ask: "Ask", deny: "Deny", folders: "Folders" };
const PLACEHOLDERS: Record<RuleList, string> = { allow: "Bash(npm test:*)", ask: "Bash(git push:*)", deny: "Read(./.env)", folders: "../other-project" };

export function PermissionsPanel({ sessionId, data }: { sessionId: string; data: PermissionsPanelData }) {
  const [list, setList] = useState<RuleList>("allow");
  const [text, setText] = useState("");
  const [file, setFile] = useState(data.files[data.files.length - 1].file);
  const send = (action: string, payload: { list?: RuleList; text?: string; file: string }) => panelAction(sessionId, "permissions", action, { list, ...payload });
  const add = () => {
    if (text.trim()) {
      send("add", { text, file });
      setText("");
    }
  };
  return (
    <div>
      <div class="setp-tabs" role="tablist">
        {RULE_LISTS.map((name) => (
          <button type="button" role="tab" class="setp-tab" aria-selected={name === list} onClick={() => setList(name)}>
            {TABS[name]} ({data.rules[name].length})
          </button>
        ))}
      </div>
      {data.files.map((entry) => entry.error && <p class="setp-error">{entry.label}: {entry.error}. It is not editable until fixed.</p>)}
      {data.rules[list].length === 0 && <p class="cmdp-empty">No {TABS[list].toLowerCase()} {list === "folders" ? "set" : "rules"}.</p>}
      {data.rules[list].map((rule) => (
        <div class="setp-row">
          <span class="setp-text">{rule.text}</span>
          <span class="setp-src">{rule.label}</span>
          <button type="button" class="cmdp-btn" onClick={() => send("remove", { text: rule.text, file: rule.file })}>Remove</button>
        </div>
      ))}
      <div class="setp-add">
        <input value={text} placeholder={PLACEHOLDERS[list]} onInput={(event) => setText(event.currentTarget.value)} onKeyDown={(event) => event.key === "Enter" && add()} />
        <select value={file} onChange={(event) => setFile(event.currentTarget.value)}>
          {data.files.map((entry) => <option value={entry.file}>{entry.label}</option>)}
        </select>
        <button type="button" class="cmdp-btn" onClick={add}>Add</button>
      </div>
      <p class="setp-note">Changes are saved now and apply to new turns and chats, per Claude Code's settings reload.</p>
      {list === "folders" && data.sessionFolders.length > 0 && (
        <>
          <h3 class="setp-h">Added to this chat <small>(read-only, from /add-dir)</small></h3>
          {data.sessionFolders.map((folder) => <div class="setp-row"><span class="setp-text">{folder}</span></div>)}
        </>
      )}
      <h3 class="setp-h">Files</h3>
      {data.files.map((entry) => (
        <div class="setp-row">
          <span class="setp-text">{entry.label}<br /><span class="setp-src">{entry.file}</span></span>
          {entry.exists ? <button type="button" class="cmdp-btn" onClick={() => send("open", { file: entry.file })}>Open file</button> : <span class="setp-src">not created yet</span>}
        </div>
      ))}
    </div>
  );
}
