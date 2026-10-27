import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { highlightCode, languageFor } from "../highlight";
import { renderMarkdown } from "../markdown";
import { post, setUi, useSession } from "../store";
import { buildItems, displayPath, MAX_OUTPUT, messageUuid, searchText, textOnlyRows, turnOutputTokens, type Item, type Row as TranscriptRow } from "../transcript";
import { clearMatches, fillComposer, findMatches, paintMatches, revealMatch } from "../transcriptSearch";
import { Icon } from "./Icon";
import { PermissionCard } from "./PermissionCard";
import { TranscriptSearch } from "./TranscriptSearch";
import { WorkflowCard } from "./WorkflowCard";
import "./transcript.css";

const COMPACT_ITEMS = 12;
const BOTTOM_SLACK = 48;
const GLYPHS = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
const VERBS = ["Thinking", "Pondering", "Cogitating", "Working", "Brewing", "Noodling", "Mulling", "Churning", "Ruminating", "Simmering"];
const VERB_MS = 4000;
const GLYPH_MS = 140;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

const CHEVRON = "M9 6l6 6-6 6";
const CHECK = "M5 12l5 5L20 7";
const FILE = "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6";
const REWIND = "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5";
const FORK = "M6 3v12 M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 9a9 9 0 0 1-9 9";
const BUSY = new Set(["starting", "working", "needs-you"]);

function Status({ pending, error }: { pending: boolean; error?: boolean }) {
  if (pending) {
    return <span class="spinner" role="status" aria-label="Running" />;
  }
  return error ? <Icon d="M6 6l12 12M18 6L6 18" size={12} /> : <span class="tr-ok"><Icon d={CHECK} size={12} stroke={3} /></span>;
}

function Fold({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ComponentChildren }) {
  return (
    <button type="button" class="tr-fold" aria-expanded={open} onClick={onToggle}>
      <span class="tr-chevron"><Icon d={CHEVRON} size={12} /></span>
      {children}
    </button>
  );
}

function useToggle(forced = false): [boolean, () => void] {
  const [open, setOpen] = useState(false);
  return [open || forced, () => setOpen((value) => !(value || forced))];
}

function Text({ text, streaming }: { text: string; streaming?: boolean }) {
  let html = renderMarkdown(text);
  if (streaming) {
    html = /<\/(p|li)>\s*$/.test(html) ? html.replace(/(<\/(?:p|li)>\s*)$/, '<span class="tr-cursor"></span>$1') : `${html}<span class="tr-cursor"></span>`;
  }
  return <div class="tr-text" dangerouslySetInnerHTML={{ __html: html }} />;
}

function Thinking({ text, streaming, forceOpen }: { text: string; streaming?: boolean; forceOpen?: boolean }) {
  const [open, toggle] = useToggle(forceOpen);
  return (
    <div class="tr-card tr-thinking">
      <Fold open={open} onToggle={toggle}>
        {streaming && <span class="spinner" />}
        <span class="tr-label">{streaming ? "Thinking…" : "Thought"}</span>
      </Fold>
      {open && <div class="tr-thinking-body">{text}</div>}
    </div>
  );
}

function Lookups({ item, cwd, forceOpen }: { item: Extract<Item, { kind: "lookups" }>; cwd?: string; forceOpen?: boolean }) {
  const [open, toggle] = useToggle(forceOpen);
  return (
    <div class="tr-card">
      <Fold open={open} onToggle={toggle}>
        {item.pending && <span class="spinner" />}
        <span class="tr-label">{item.summary}</span>
      </Fold>
      {open && (
        <ul class="tr-list">
          {item.calls.map((call) => (
            <li key={call.id} class={call.error ? "tr-del" : undefined}>
              <span class="tr-tool">{call.name}</span>
              <span class="mono">{displayPath(call.label, cwd)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Code({ text, language, class: className, title }: { text: string; language: string; class?: string; title?: string }) {
  const html = useMemo(() => highlightCode(text, language), [text, language]);
  return <span class={className} title={title} dangerouslySetInnerHTML={{ __html: html }} />;
}

function EditCard({ item, sessionId, cwd }: { item: Extract<Item, { kind: "edit" }>; sessionId: string; cwd?: string }) {
  const language = languageFor(item.path) ?? "text";
  return (
    <div class="tr-card">
      <div class="tr-head">
        <Icon d={FILE} />
        <span class="mono" title={item.path}>{displayPath(item.path, cwd)}</span>
        {item.pending && <span class="spinner" />}
        <span class="tr-add">+{item.added}</span>
        <span class="tr-del">−{item.removed}</span>
        <span class="tr-spacer" />
        <button type="button" onClick={() => post({ type: "openFile", sessionId, path: item.path })}>Open file</button>
      </div>
      {item.lines.length > 0 && (
        <div class="tr-diff">
          {item.lines.map((line, index) => (
            <div key={index} class={line.kind === "add" ? "tr-line-add" : line.kind === "del" ? "tr-line-del" : undefined}>
              {line.kind === "add" ? "+ " : line.kind === "del" ? "− " : "  "}
              <Code text={line.text} language={language} />
            </div>
          ))}
          {item.hidden > 0 && <div class="tr-more">… {item.hidden} more lines</div>}
        </div>
      )}
      {item.error && <div class="tr-err">{item.error}</div>}
    </div>
  );
}

function BashCard({ item, forceOpen }: { item: Extract<Item, { kind: "bash" }>; forceOpen?: boolean }) {
  const [open, toggle] = useToggle(forceOpen);
  const output = item.output?.trim();
  return (
    <div class="tr-card">
      <div class="tr-head">
        <span class="muted mono">$</span>
        <Code class="mono tr-bash-cmd" title={item.command} text={item.command.split("\n")[0]} language="bash" />
        <Status pending={item.pending} error={item.error} />
      </div>
      {item.description && <div class="tr-desc">{item.description}</div>}
      {output && (
        <>
          <Fold open={open} onToggle={toggle}>
            <span class="tr-label">{item.error ? "Error output" : "Output"}</span>
          </Fold>
          {open && <pre class={`tr-output${item.error ? " tr-failed" : ""}`}>{output.length > MAX_OUTPUT ? `${output.slice(0, MAX_OUTPUT)}\n… truncated` : output}</pre>}
        </>
      )}
    </div>
  );
}

function Todos({ item }: { item: Extract<Item, { kind: "todos" }> }) {
  return (
    <div class="tr-card tr-todos">
      <h3 class="section-label">To-dos · {item.done} of {item.todos.length}</h3>
      {item.todos.map((todo, index) => (
        <div key={index} class={`tr-todo tr-todo-${todo.status}`}>
          {todo.status === "completed" ? <span class="tr-ok"><Icon d={CHECK} stroke={2.4} /></span> : todo.status === "in_progress" ? <span class="spinner" /> : <span class="tr-dot" />}
          {todo.content}
        </div>
      ))}
    </div>
  );
}

function Agent({ item, sessionId }: { item: Extract<Item, { kind: "agent" }>; sessionId: string }) {
  const taskId = item.taskId;
  return (
    <div class="tr-card tr-row">
      <Status pending={item.pending} error={!!item.error} />
      <strong>{item.subagentType}</strong>
      <span class="tr-label">{item.description}</span>
      {taskId && (
        <button type="button" class="ghost" onClick={() => setUi(sessionId, { side: "workflow", workflowTaskId: taskId, agentTaskId: taskId })}>Open</button>
      )}
      {item.error && <span class="tr-del">{item.error.slice(0, 80)}</span>}
    </div>
  );
}

function Tool({ item }: { item: Extract<Item, { kind: "tool" }> }) {
  return (
    <div class="tr-card">
      <div class="tr-row">
        <Status pending={item.pending} error={!!item.error} />
        <strong>{item.name}</strong>
        <span class="tr-label mono">{item.summary}</span>
      </div>
      {item.error && <div class="tr-err">{item.error.slice(0, 400)}</div>}
    </div>
  );
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatCount(count: number): string {
  return count < 1000 ? String(count) : `${(count / 1000).toFixed(1)}k`;
}

function formatTokens(count: number): string {
  return `${formatCount(count)} tokens`;
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(cost < 0.01 ? 4 : cost < 1 ? 3 : 2)}`;
}

function Usage({ item }: { item: Extract<Item, { kind: "usage" }> }) {
  const parts = [`${formatCount(item.input)} in`, `${formatCount(item.output)} out`];
  if (item.cacheRead > 0 || item.cacheWrite > 0) {
    parts.push(`cache ${formatCount(item.cacheRead)} read, ${formatCount(item.cacheWrite)} written`);
  }
  if (item.cost !== undefined) {
    parts.push(formatCost(item.cost));
  }
  return (
    <div class="tr-usage" title="Tokens are the main agent's. Cost is this turn's, subagents included.">
      {parts.join(" · ")}
    </div>
  );
}

function useTick(intervalMs: number): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return Date.now();
}

function WorkingLine({ since, tokens, generic, compact }: { since: number; tokens: number; generic: boolean; compact?: boolean }) {
  const still = useMemo(() => window.matchMedia(REDUCED_MOTION).matches, []);
  const now = useTick(still ? 1000 : GLYPH_MS);
  const elapsed = now - since;
  const verb = generic ? "Working" : VERBS[(Math.floor(elapsed / VERB_MS) + (since % VERBS.length)) % VERBS.length];
  const glyph = still ? "✻" : GLYPHS[Math.floor(now / GLYPH_MS) % GLYPHS.length];
  return (
    <div class="tr-working">
      <span class="tr-working-glyph" aria-hidden="true">{glyph}</span>
      <span class="tr-working-verb">{verb}…</span>
      <span class="tr-working-meta">
        {formatElapsed(elapsed)}
        {!compact && tokens > 0 && ` · ↓ ${formatTokens(tokens)}`}
        {!compact && " · esc to interrupt"}
      </span>
    </div>
  );
}

function HiddenDivider({ calls, onShow }: { calls: number; onShow: () => void }) {
  const label = calls === 0 ? "Hidden" : `${calls} tool ${calls === 1 ? "call" : "calls"} hidden`;
  return (
    <button type="button" class="tr-hidden" title="Show everything here" onClick={onShow}>
      <span>· {label} ·</span>
    </button>
  );
}

function Row({ item, sessionId, cwd, forceOpen }: { item: Item; sessionId: string; cwd?: string; forceOpen?: boolean }) {
  switch (item.kind) {
    case "user":
      return (
        <div class="tr-user">
          {item.text}
          {item.images.length > 0 && (
            <div class="tr-thumbs">
              {item.images.map((url, index) => (
                <img key={index} class="tr-thumb" src={url} alt={`Attached image ${index + 1}`} />
              ))}
            </div>
          )}
        </div>
      );
    case "text":
      return <Text text={item.text} streaming={item.streaming} />;
    case "thinking":
      return <Thinking text={item.text} streaming={item.streaming} forceOpen={forceOpen} />;
    case "lookups":
      return <Lookups item={item} cwd={cwd} forceOpen={forceOpen} />;
    case "edit":
      return <EditCard item={item} sessionId={sessionId} cwd={cwd} />;
    case "bash":
      return <BashCard item={item} forceOpen={forceOpen} />;
    case "todos":
      return <Todos item={item} />;
    case "agent":
      return <Agent item={item} sessionId={sessionId} />;
    case "workflow":
      return <WorkflowCard sessionId={sessionId} toolUseId={item.toolUseId} input={item.input} />;
    case "tool":
      return <Tool item={item} />;
    case "note":
      return <div class={`tr-note${item.tone === "error" ? " tr-note-error" : ""}`}>{item.text}</div>;
    case "usage":
      return <Usage item={item} />;
  }
}

function RowActions({ item, sessionId, rewindable, first }: { item: Item; sessionId: string; rewindable: boolean; first: boolean }) {
  const uuid = messageUuid(item);
  if (!uuid || first) {
    return null;
  }
  const text = item.kind === "user" ? item.text : undefined;
  return (
    <div class="tr-actions" role="group" aria-label="Message actions">
      {text !== undefined && rewindable && (
        <button type="button" aria-label="Rewind to here" title="Rewind to here" onClick={() => post({ type: "rewind", sessionId, userMessageId: uuid, text })}>
          <Icon d={REWIND} />
        </button>
      )}
      <button type="button" aria-label="Fork from here" title="Fork from here" onClick={() => post({ type: "fork", sessionId, messageId: uuid, before: text !== undefined, draft: text })}>
        <Icon d={FORK} />
      </button>
    </div>
  );
}

type Anchor = { id: string; offset: number };

function captureAnchor(scroller: HTMLElement): Anchor | undefined {
  const top = scroller.getBoundingClientRect().top;
  for (const el of scroller.querySelectorAll<HTMLElement>("[data-item]")) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > top) {
      return { id: el.dataset.item!, offset: rect.top - top };
    }
  }
  return undefined;
}

function findItem(scroller: HTMLElement, id: string): HTMLElement | null {
  return scroller.querySelector<HTMLElement>(`[data-item="${CSS.escape(id)}"]`);
}

export function Transcript({ sessionId, compact }: { sessionId: string; compact?: boolean }) {
  const session = useSession(sessionId);
  const items = useMemo(() => buildItems(session.messages), [session.messages]);
  const textOnly = session.ui.textOnly ?? session.meta?.textOnly === true;
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [focusTick, setFocusTick] = useState(0);
  const needle = searching && query.trim() ? query.toLowerCase() : "";
  const rows = useMemo<TranscriptRow[]>(() => (textOnly && !needle ? textOnlyRows(items) : items), [items, textOnly, needle]);
  const shown = compact ? rows.slice(-COMPACT_ITEMS) : rows;
  const matched = useMemo(() => new Set(needle ? shown.filter((row) => row.kind !== "hidden" && searchText(row).toLowerCase().includes(needle)).map((row) => row.id) : []), [shown, needle]);
  const firstUserId = useMemo(() => items.find((item) => item.kind === "user")?.id, [items]);
  const rewindable = !!session.meta && !BUSY.has(session.meta.status);
  const working = session.meta?.status === "working" && session.permissions.length === 0;
  const tokens = useMemo(() => (working ? turnOutputTokens(session.messages) : 0), [working, session.messages]);
  const lastItem = items[items.length - 1];
  const toolRunning = !!lastItem && "pending" in lastItem && lastItem.pending;
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const anchor = useRef<Anchor>();
  const revealId = useRef<string>();
  const searchBox = useRef<HTMLInputElement>(null);
  const hits = useRef<Range[]>([]);
  const jump = useRef(false);
  const [away, setAway] = useState(false);

  const scrollToEnd = () => {
    const el = scroller.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  };

  const onScroll = () => {
    const el = scroller.current!;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK;
    setAway(!pinned.current);
  };

  const onClick = (event: MouseEvent) => {
    const link = (event.target as HTMLElement).closest("a");
    const url = link?.dataset.href || link?.href;
    if (url) {
      event.preventDefault();
      post({ type: "openUrl", url });
    }
  };

  const setTextOnly = (value: boolean) => {
    anchor.current = scroller.current ? captureAnchor(scroller.current) : undefined;
    setUi(sessionId, { textOnly: value });
    post({ type: "setTextOnly", sessionId, value });
  };

  const revealHidden = (firstId: string) => {
    revealId.current = firstId;
    setUi(sessionId, { textOnly: false });
  };

  const closeSearch = () => {
    setSearching(false);
    setQuery("");
    document.getElementById(`cmp-${sessionId}`)?.focus();
  };

  const searchFor = (value: string) => {
    jump.current = true;
    setCurrent(0);
    setQuery(value);
  };

  const step = (delta: number) => {
    const count = hits.current.length;
    if (count > 0) {
      jump.current = true;
      setCurrent((at) => (at + delta + count) % count);
    }
  };

  const textOnlyRef = useRef(textOnly);
  textOnlyRef.current = textOnly;
  const toggleRef = useRef(setTextOnly);
  toggleRef.current = setTextOnly;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey || event.key.toLowerCase() !== "t") {
        return;
      }
      if (compact && !root.current?.contains(document.activeElement)) {
        return;
      }
      event.preventDefault();
      toggleRef.current(!textOnlyRef.current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compact]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "f") {
        return;
      }
      if (compact && !root.current?.contains(document.activeElement)) {
        return;
      }
      event.preventDefault();
      const selected = window.getSelection()?.toString().trim() ?? "";
      if (selected && selected.length <= 100 && !selected.includes("\n")) {
        jump.current = true;
        setCurrent(0);
        setQuery(selected);
      }
      setSearching(true);
      setFocusTick((tick) => tick + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compact]);

  useEffect(() => {
    searchBox.current?.focus();
    searchBox.current?.select();
  }, [focusTick]);

  useEffect(() => clearMatches, []);

  useLayoutEffect(() => {
    const found = scroller.current && needle ? findMatches(scroller.current, needle) : [];
    const at = Math.min(current, Math.max(found.length - 1, 0));
    hits.current = found;
    setTotal(found.length);
    setCurrent(at);
    if (found.length === 0) {
      clearMatches();
      return;
    }
    paintMatches(found, at);
    if (jump.current) {
      jump.current = false;
      revealMatch(found[at]);
    }
  }, [shown, needle, current, matched]);

  const draft = session.ui.draft;
  useEffect(() => {
    if (draft === undefined) {
      return;
    }
    let tries = 0;
    let frame = 0;
    const attempt = () => {
      if (fillComposer(sessionId, draft) || ++tries > 30) {
        setUi(sessionId, { draft: undefined });
      } else {
        frame = requestAnimationFrame(attempt);
      }
    };
    frame = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(frame);
  }, [draft, sessionId]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) {
      return;
    }
    if (revealId.current) {
      findItem(el, revealId.current)?.scrollIntoView({ block: "center" });
      revealId.current = undefined;
      anchor.current = undefined;
    } else if (anchor.current && !pinned.current) {
      const ids = [anchor.current.id, ...items.slice(Math.max(0, items.findIndex((item) => item.id === anchor.current!.id))).map((item) => item.id)];
      const target = ids.map((id) => findItem(el, id)).find(Boolean);
      if (target) {
        el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.current.offset;
      }
      anchor.current = undefined;
    }
  }, [textOnly]);

  useLayoutEffect(() => {
    if (pinned.current) {
      scrollToEnd();
    }
  }, [shown, session.permissions, working]);

  return (
    <div class={`chat-transcript${compact ? " tr-compact" : ""}`} data-session={sessionId} ref={root}>
      <div class="tr-scroll" ref={scroller} onScroll={onScroll} onClick={onClick}>
        <div class="tr-pillbar">
          <button type="button" class="tr-pill" aria-pressed={textOnly} title="Show only messages (Ctrl/Cmd+Shift+T)" onClick={() => setTextOnly(!textOnly)}>
            Text only
          </button>
        </div>
        <div class="tr-inner">
          {shown.map((row) =>
            row.kind === "hidden" ? (
              <HiddenDivider key={row.id} calls={row.calls} onShow={() => revealHidden(row.firstId)} />
            ) : (
              <div key={row.id} class="tr-item" data-item={row.id}>
                <Row item={row} sessionId={sessionId} cwd={session.meta?.cwd} forceOpen={matched.has(row.id)} />
                <RowActions item={row} sessionId={sessionId} rewindable={rewindable} first={row.id === firstUserId} />
              </div>
            )
          )}
          {session.permissions.map((request) => (
            <PermissionCard key={request.id} sessionId={sessionId} request={request} compact={compact} />
          ))}
          {working && session.meta && <WorkingLine since={session.meta.statusSince} tokens={tokens} generic={toolRunning} compact={compact} />}
        </div>
      </div>
      {searching && <TranscriptSearch query={query} current={current} total={total} inputRef={searchBox} onQuery={searchFor} onStep={step} onClose={closeSearch} />}
      {away && (
        <button
          type="button"
          class="tr-jump"
          onClick={() => {
            pinned.current = true;
            scrollToEnd();
            setAway(false);
          }}
        >
          Jump to latest
        </button>
      )}
    </div>
  );
}
