import { useState } from "preact/hooks";
import { post, useStore, type State } from "../store";
import { Icon } from "./Icon";
import "./add-agent.css";

const selectRail = (state: State) => state.rail;

// + starts a new agent next to `newFrom`; the caret adds an existing chat. Without `newFrom`, + only opens the list.
export function AddAgent({ exclude, newFrom }: { exclude: string[]; newFrom?: string }) {
  const [open, setOpen] = useState(false);
  const rail = useStore(selectRail);
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const available = rail.filter((entry) => !exclude.includes(entry.sessionId) && (!needle || `${entry.title} ${entry.repo}`.toLowerCase().includes(needle)));
  const add = (sessionId: string) => {
    post({ type: "grid", action: "add", sessionId });
    setOpen(false);
    setFilter("");
  };
  const toggle = (
    <button type="button" class="ghost hdr-icon" aria-label="Add an existing chat" title="Add an existing chat" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>
      <Icon d={newFrom ? "M6 9l6 6 6-6" : "M12 5v14M5 12h14"} />
    </button>
  );
  return (
    <div class={`add-agent${newFrom ? " split" : ""}`} onKeyDown={(event) => event.key === "Escape" && setOpen(false)}>
      {newFrom && (
        <button type="button" class="ghost hdr-icon" aria-label="Add agent" title="Add agent: start another agent in this folder" onClick={() => post({ type: "addAgent", sessionId: newFrom })}>
          <Icon d="M12 5v14M5 12h14" />
        </button>
      )}
      {toggle}
      {open && (
        <div class="add-agent-menu" role="menu" aria-label="Chats to add">
          <div class="add-agent-head">Add an existing chat</div>
          <input id="add-agent-filter" class="add-agent-filter" placeholder="Filter chats" value={filter} autoFocus onInput={(event) => setFilter(event.currentTarget.value)} />
          {available.length === 0 && <div class="add-agent-empty muted">{needle ? "No chats match." : "Every chat is already here."}</div>}
          {available.map((entry) => (
            <button key={entry.sessionId} type="button" class="ghost add-agent-item" role="menuitem" title={entry.title} onClick={() => add(entry.sessionId)}>
              <span class={`hdr-dot hdr-dot-${entry.column}`} aria-hidden="true" />
              <span class="add-agent-title">{entry.title}</span>
              <span class="muted add-agent-repo">{entry.repo}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
