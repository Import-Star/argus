import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { QueuedMessage } from "../../../src/chat/protocol";
import { post, useSession } from "../store";
import "./queue.css";

type Action = "remove" | "up" | "down" | "sendNow";

function Icon({ children }: { children: ComponentChildren }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function Row({ item, index, count, sessionId }: { item: QueuedMessage; index: number; count: number; sessionId: string }) {
  const [draft, setDraft] = useState<string>();
  const box = useRef<HTMLTextAreaElement>(null);
  const text = draft ?? "";
  const editing = draft !== undefined && !item.sent;
  const act = (action: Action) => post({ type: "queue", sessionId, id: item.id, action });

  useEffect(() => {
    if (editing) {
      box.current?.focus();
    }
  }, [editing]);

  function save() {
    const next = text.trim();
    if (next && next !== item.text) {
      post({ type: "queue", sessionId, id: item.id, action: "edit", text: next });
    }
    setDraft(undefined);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDraft(undefined);
    } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      save();
    }
  }

  return (
    <li class={`q-row${item.sent ? " q-sent" : ""}`}>
      <span class="q-num" aria-hidden="true">
        {index + 1}
      </span>
      <div class="q-main">
        {editing ? (
          <>
            <label class="sr-only" for={`q-${item.id}`}>
              Edit queued message {index + 1}
            </label>
            <textarea id={`q-${item.id}`} ref={box} class="q-edit" rows={Math.min(6, text.split("\n").length + 1)} value={text} onInput={(event) => setDraft(event.currentTarget.value)} onKeyDown={onKeyDown} />
            <div class="q-edit-bar">
              <button type="button" class="primary" disabled={!text.trim()} onClick={save}>
                Save
              </button>
              <button type="button" onClick={() => setDraft(undefined)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div class="q-text" title={item.text}>
              {item.text}
            </div>
            {item.images > 0 && <div class="q-note">{item.images === 1 ? "1 image" : `${item.images} images`}</div>}
            {item.sent && <div class="q-note q-warn">Already handed to Claude: it can't be edited, moved or removed.</div>}
          </>
        )}
      </div>
      {!editing && !item.sent && (
        <div class="q-actions">
          <button type="button" class="ghost q-icon" aria-label={`Edit queued message ${index + 1}`} title="Edit" onClick={() => setDraft(item.text)}>
            <Icon>
              <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </Icon>
          </button>
          <button type="button" class="ghost q-icon" aria-label={`Move queued message ${index + 1} up`} title="Move up" disabled={index === 0} onClick={() => act("up")}>
            <Icon>
              <path d="M6 15l6-6 6 6" />
            </Icon>
          </button>
          <button type="button" class="ghost q-icon" aria-label={`Move queued message ${index + 1} down`} title="Move down" disabled={index === count - 1} onClick={() => act("down")}>
            <Icon>
              <path d="M6 9l6 6 6-6" />
            </Icon>
          </button>
          <button type="button" class="ghost q-now" aria-label={`Send queued message ${index + 1} now`} title="Interrupt Claude and send this next" onClick={() => act("sendNow")}>
            <Icon>
              <path d="M13 2 4 14h7l-1 8 9-12h-7Z" />
            </Icon>
            <span>Send now</span>
          </button>
          <button type="button" class="ghost q-icon" aria-label={`Remove queued message ${index + 1}`} title="Remove" onClick={() => act("remove")}>
            <Icon>
              <path d="M18 6 6 18M6 6l12 12" />
            </Icon>
          </button>
        </div>
      )}
    </li>
  );
}

export function Queue({ sessionId }: { sessionId: string }) {
  const { queue } = useSession(sessionId);
  if (queue.length === 0) {
    return null;
  }
  return (
    <section class="q" aria-label="Queued messages">
      <div class="q-head">
        <span class="q-title">Queued ({queue.length})</span>
        <span class="q-hint">Claude reads these at its next step</span>
      </div>
      <ol class="q-list">
        {queue.map((item, index) => (
          <Row key={item.id} item={item} index={index} count={queue.length} sessionId={sessionId} />
        ))}
      </ol>
    </section>
  );
}
