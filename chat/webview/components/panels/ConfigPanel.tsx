import { useState } from "preact/hooks";
import type { ConfigSetting } from "../../../../src/chat/configUsage";
import type { ConfigPanelData } from "../../../../src/chat/panels/config";
import { panelAction } from "./CommandPanel";

function Field({ setting, value, onSet }: { setting: ConfigSetting; value: string | undefined; onSet: (value: string) => void }) {
  const [draft, setDraft] = useState(value ?? "");
  if (setting.kind === "boolean") {
    return (
      <span class="cfg-choice">
        {setting.options.map((option) => (
          <button key={option} type="button" class={`cmdp-btn${value === option ? " cfg-on" : ""}`} onClick={() => onSet(option)}>
            {option === "true" ? "On" : "Off"}
          </button>
        ))}
      </span>
    );
  }
  if (setting.kind === "enum") {
    return (
      <select class="cfg-input" value={value ?? ""} onChange={(event) => onSet(event.currentTarget.value)}>
        {value === undefined && <option value="">not set</option>}
        {setting.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  return (
    <span class="cfg-choice">
      <input class="cfg-input" value={draft} onInput={(event) => setDraft(event.currentTarget.value)} onKeyDown={(event) => event.key === "Enter" && draft && onSet(draft)} />
      <button type="button" class="cmdp-btn" disabled={!draft || draft === value} onClick={() => onSet(draft)}>
        Set
      </button>
    </span>
  );
}

export function ConfigPanel({ sessionId, data }: { sessionId: string; data: ConfigPanelData }) {
  const [search, setSearch] = useState("");
  // Values set from this panel, until the CLI's settings reflect them.
  const [changed, setChanged] = useState<Record<string, string>>({});
  if (data.error) {
    return <p class="cmdp-empty">Couldn't load settings: {data.error}</p>;
  }
  const shown = data.settings.filter((setting) => setting.key.toLowerCase().includes(search.trim().toLowerCase()));
  const set = (key: string, value: string) => {
    setChanged({ ...changed, [key]: value });
    panelAction(sessionId, "config", "set", { key, value });
  };
  return (
    <div>
      <input class="cfg-input cfg-search" placeholder="Search settings" value={search} onInput={(event) => setSearch(event.currentTarget.value)} />
      {shown.map((setting) => (
        <div key={setting.key} class="cfg-row">
          <span class="cfg-key">{setting.key}</span>
          <Field setting={setting} value={changed[setting.key] ?? data.values[setting.key]} onSet={(value) => set(setting.key, value)} />
        </div>
      ))}
      {shown.length === 0 && <p class="cmdp-empty">No settings match.</p>}
    </div>
  );
}
