import type { ContextPanelData, SegmentKind } from "../../../../src/chat/panels/context";
import { formatTokens } from "../Header";
import "./usagePanels.css";

const COLORS: Record<string, string> = {
  system_prompt: "var(--blue)",
  system_tools: "var(--accent)",
  mcp_tools: "var(--green)",
  mcp_instructions: "var(--green)",
  custom_agents: "var(--amber)",
  memory_files: "var(--danger)",
  skills: "var(--text)",
  messages: "var(--strong)"
};

const EMPTY: Partial<Record<SegmentKind, string>> = { free: "var(--row)", buffer: "var(--border)", deferred: "var(--dim)" };

const color = (id: string, kind: SegmentKind) => EMPTY[kind] ?? COLORS[id] ?? "var(--muted)";

export function ContextPanel({ data }: { sessionId: string; data: ContextPanelData }) {
  if (!data) {
    return <p class="cmdp-empty">No running session to measure yet.</p>;
  }
  const bar = data.segments.filter((segment) => segment.kind !== "deferred" && segment.tokens > 0);
  return (
    <>
      <p class="up-total">
        <strong>{formatTokens(data.total)}</strong> / {formatTokens(data.max)} tokens ({data.percent}%) <span class="muted">{data.model}</span>
      </p>
      <div class="up-stack" role="img" aria-label={`${data.percent}% of the context window used`}>
        {bar.map((segment) => (
          <div key={segment.id} title={`${segment.name}: ${segment.tokens.toLocaleString()} tokens`} style={{ width: `${segment.percent}%`, background: color(segment.id, segment.kind) }} />
        ))}
      </div>
      <ul class="up-legend">
        {data.segments.map((segment) => (
          <li key={segment.id} class={segment.kind === "deferred" ? "muted" : ""}>
            <i style={{ background: color(segment.id, segment.kind) }} />
            <span class="up-name">{segment.name}{segment.kind === "deferred" ? " (not loaded)" : ""}</span>
            <span class="up-num">{segment.tokens.toLocaleString()}</span>
            <span class="up-num muted">{segment.percent.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
      {data.items.length > 0 && (
        <>
          <h3 class="up-sub">Largest items</h3>
          <ul class="up-legend">
            {data.items.map((item) => (
              <li key={`${item.group}:${item.name}`}>
                <span class="up-name" title={item.name}>{item.name}</span>
                <span class="muted up-group">{item.group}</span>
                <span class="up-num">{item.tokens.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
