import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { HostMessage } from "../../../src/chat/protocol";
import { renderMarkdown } from "../markdown";
import { post } from "../store";
import "./sideQuestion.css";

interface Ask {
  id: string;
  question: string;
  text: string;
  status: "streaming" | "done" | "error";
  error?: string;
}

interface AsideState {
  open: boolean;
  asks: Ask[];
}

const CLOSED: AsideState = { open: false, asks: [] };
const BOTTOM_SLACK = 48;
const PANEL_GAP = 8;
const SCREEN_MARGIN = 16;

let states: Record<string, AsideState> = {};
let counter = 0;
const listeners = new Set<() => void>();

function setAside(sessionId: string, next: AsideState): void {
  states = { ...states, [sessionId]: next };
  listeners.forEach((listener) => listener());
}

function useAside(sessionId: string): AsideState {
  const [value, setValue] = useState(() => states[sessionId] ?? CLOSED);
  useEffect(() => {
    const listener = () => setValue(states[sessionId] ?? CLOSED);
    listeners.add(listener);
    listener();
    return () => void listeners.delete(listener);
  }, [sessionId]);
  return value;
}

function openAside(sessionId: string): void {
  setAside(sessionId, { ...(states[sessionId] ?? CLOSED), open: true });
}

function closeAside(sessionId: string): void {
  if (states[sessionId]?.open) {
    setAside(sessionId, CLOSED);
    post({ type: "asideClose", sessionId });
  }
}

function askAside(sessionId: string, question: string): void {
  const askId = `${Date.now()}-${++counter}`;
  const current = states[sessionId] ?? CLOSED;
  setAside(sessionId, { ...current, asks: [...current.asks, { id: askId, question, text: "", status: "streaming" }] });
  post({ type: "aside", sessionId, askId, text: question });
}

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  const current = message?.type === "aside" ? states[message.sessionId] : undefined;
  if (message?.type !== "aside" || !current) {
    return;
  }
  const asks = current.asks.map((ask) => (ask.id === message.askId ? { ...ask, text: message.text, status: message.status, error: message.error } : ask));
  setAside(message.sessionId, { ...current, asks });
});

function onLinkClick(event: MouseEvent): void {
  const link = (event.target as HTMLElement).closest("a");
  const url = link?.dataset.href || link?.href;
  if (url) {
    event.preventDefault();
    post({ type: "openUrl", url });
  }
}

function AskView({ ask }: { ask: Ask }) {
  const streaming = ask.status === "streaming";
  return (
    <li class="aside-ask">
      <div class="aside-question">{ask.question}</div>
      {ask.text && <div class="tr-text aside-answer" aria-busy={streaming} onClick={onLinkClick} dangerouslySetInnerHTML={{ __html: renderMarkdown(ask.text) }} />}
      {streaming && !ask.text && (
        <div class="aside-wait" role="status">
          <span class="spinner" />
          Thinking…
        </div>
      )}
      {ask.status === "error" && (
        <div class="aside-error" role="alert">
          {ask.error ?? "The side question failed."}
        </div>
      )}
    </li>
  );
}

function Panel({ sessionId, asks, top, onClose }: { sessionId: string; asks: Ask[]; top: number; onClose: () => void }) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const pinned = useRef(true);
  const busy = asks.some((ask) => ask.status === "streaming");

  useEffect(() => input.current?.focus(), []);
  useLayoutEffect(() => {
    const el = list.current;
    if (el && pinned.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [asks]);

  const submit = () => {
    const question = draft.trim();
    if (question && !busy) {
      pinned.current = true;
      setDraft("");
      askAside(sessionId, question);
    }
  };

  return (
    <div
      id="aside-panel"
      class="aside-panel"
      role="dialog"
      aria-label="Side question"
      style={{ top: `${top}px`, maxHeight: `min(560px, calc(100vh - ${top + SCREEN_MARGIN}px))` }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div class="aside-head">
        <strong>Ask aside</strong>
        <span class="muted">Not added to the conversation</span>
        <button type="button" class="ghost aside-close" aria-label="Close side question" onClick={onClose}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {asks.length > 0 ? (
        <ul
          class="aside-list"
          ref={list}
          onScroll={() => {
            const el = list.current!;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK;
          }}
        >
          {asks.map((ask) => (
            <AskView key={ask.id} ask={ask} />
          ))}
        </ul>
      ) : (
        <p class="aside-empty muted">Ask a quick question about this session. Claude answers from the conversation so far, read-only, and nothing is added to it.</p>
      )}
      <form
        class="aside-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={input}
          class="aside-input"
          rows={2}
          aria-label="Side question"
          placeholder="Ask about this session…"
          value={draft}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        {busy && <span class="spinner" role="status" aria-label="Answering" />}
        <button type="submit" class="primary" disabled={busy || !draft.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}

export function SideQuestion({ sessionId }: { sessionId: string }) {
  const { open, asks } = useAside(sessionId);
  const button = useRef<HTMLButtonElement>(null);
  const [top, setTop] = useState(0);

  const place = () => setTop(Math.round((button.current?.getBoundingClientRect().bottom ?? 0) + PANEL_GAP));
  const close = () => {
    closeAside(sessionId);
    button.current?.focus();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ";") {
        event.preventDefault();
        if (states[sessionId]?.open) {
          close();
        } else {
          openAside(sessionId);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sessionId]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  useEffect(() => () => closeAside(sessionId), [sessionId]);

  return (
    <>
      <button
        ref={button}
        type="button"
        class="aside-toggle"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? "aside-panel" : undefined}
        title="Ask a side question without adding to the conversation (Ctrl/Cmd+;)"
        onClick={() => (open ? close() : openAside(sessionId))}
      >
        Ask aside
      </button>
      {open && <Panel sessionId={sessionId} asks={asks} top={top} onClose={close} />}
    </>
  );
}
