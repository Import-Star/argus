import { useRef, useState } from "preact/hooks";
import { inlineParts, lastPlan, parsePlan, planComments, type PlanBlock, type PlanComment } from "../plan";
import { setUi, useSession } from "../store";
import { approvePlan, decide } from "./PermissionCard";
import "./plan.css";

interface Selection {
  block: number;
  quote: string;
  top: number;
  left: number;
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineParts(text).map((part, index) => (part.code ? <code key={index}>{part.text}</code> : part.bold ? <strong key={index}>{part.text}</strong> : part.text))}
    </>
  );
}

function Block({ block }: { block: PlanBlock }) {
  if (block.kind === "heading") {
    return <h3 class={`plan-h plan-h${Math.min(block.level, 3)}`}><Inline text={block.text} /></h3>;
  }
  if (block.kind === "code") {
    return <pre class="plan-code">{block.text}</pre>;
  }
  if (block.kind === "list") {
    const Tag = block.ordered ? "ol" : "ul";
    return (
      <Tag class="plan-list">
        {block.items.map((item, index) => (
          <li key={index}><Inline text={item} /></li>
        ))}
      </Tag>
    );
  }
  return <p class="plan-para"><Inline text={block.text} /></p>;
}

function CommentCard({ comment, editing, onSave, onEdit, onRemove }: { comment: PlanComment; editing: boolean; onSave: (text: string) => void; onEdit: () => void; onRemove: () => void }) {
  const [draft, setDraft] = useState(comment.text);
  return (
    <div class="plan-comment">
      <blockquote>{comment.quote}</blockquote>
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave(draft.trim());
          }}
        >
          <textarea aria-label="Comment" rows={2} autoFocus value={draft} onInput={(event) => setDraft(event.currentTarget.value)} />
          <div class="plan-comment-actions">
            <button type="submit" class="primary" disabled={draft.trim() === ""}>Save</button>
            <button type="button" onClick={onRemove}>{comment.text === "" ? "Cancel" : "Remove"}</button>
          </div>
        </form>
      ) : (
        <>
          <div class="plan-comment-text">{comment.text}</div>
          <div class="plan-comment-actions">
            <button type="button" class="ghost" onClick={onEdit}>Edit</button>
            <button type="button" class="ghost" onClick={onRemove}>Remove</button>
          </div>
        </>
      )}
    </div>
  );
}

function blockIndex(node: Node | null): number | undefined {
  const element = node instanceof Element ? node : node?.parentElement;
  const found = element?.closest<HTMLElement>("[data-block]");
  return found ? Number(found.dataset.block) : undefined;
}

export function PlanPane({ sessionId }: { sessionId: string }) {
  const session = useSession(sessionId);
  const request = session.permissions.find((item) => item.toolName === "ExitPlanMode");
  const plan = typeof request?.input.plan === "string" ? request.input.plan : lastPlan(session.messages);
  const blocks = parsePlan(plan ?? "");
  const scroller = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection>();
  const [comments, setComments] = useState<PlanComment[]>([]);
  const [editing, setEditing] = useState<number>();
  const nextId = useRef(1);
  const sendable = comments.filter((comment) => comment.text !== "");

  const onMouseUp = () => {
    const host = scroller.current;
    const picked = window.getSelection();
    const block = picked && picked.rangeCount > 0 ? blockIndex(picked.anchorNode) : undefined;
    const quote = picked?.toString().trim();
    if (!request || !host || !picked || picked.isCollapsed || !quote || block === undefined || blockIndex(picked.focusNode) === undefined) {
      setSelection(undefined);
      return;
    }
    const rect = picked.getRangeAt(0).getBoundingClientRect();
    const box = host.getBoundingClientRect();
    setSelection({ block, quote, top: rect.bottom - box.top + host.scrollTop + 4, left: Math.max(0, rect.left - box.left) });
  };

  const addComment = () => {
    if (!selection) {
      return;
    }
    const id = nextId.current++;
    setComments([...comments, { id, block: selection.block, quote: selection.quote, text: "" }]);
    setEditing(id);
    setSelection(undefined);
    window.getSelection()?.removeAllRanges();
  };

  const remove = (id: number) => {
    setComments(comments.filter((comment) => comment.id !== id));
    setEditing(undefined);
  };

  const save = (id: number, text: string) => {
    setComments(comments.map((comment) => (comment.id === id ? { ...comment, text } : comment)));
    setEditing(undefined);
  };

  return (
    <aside class="plan-pane" aria-label="Plan">
      <div class="plan-head">
        <span class="plan-title">Plan</span>
        <span class="muted">{request ? "Select text to comment" : "No plan waiting for approval"}</span>
        <button type="button" class="ghost plan-close" aria-label="Close plan" onClick={() => setUi(sessionId, { side: "details" })}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div class="plan-body" ref={scroller} onMouseUp={onMouseUp}>
        {blocks.length === 0 ? <div class="muted">No plan yet.</div> : null}
        {blocks.map((block, index) => (
          <div class="plan-block" data-block={index} key={index}>
            <Block block={block} />
            {comments
              .filter((comment) => comment.block === index)
              .map((comment) => (
                <CommentCard key={comment.id} comment={comment} editing={editing === comment.id} onSave={(text) => save(comment.id, text)} onEdit={() => setEditing(comment.id)} onRemove={() => remove(comment.id)} />
              ))}
          </div>
        ))}
        {selection ? (
          <button type="button" class="primary plan-add" style={{ top: `${selection.top}px`, left: `${selection.left}px` }} onMouseDown={(event) => event.preventDefault()} onClick={addComment}>
            Comment
          </button>
        ) : null}
      </div>
      {request ? (
        <div class="plan-foot">
          <button type="button" class="primary" onClick={() => approvePlan(sessionId, request.id, "acceptEdits")}>
            Approve, accept edits
          </button>
          <button type="button" onClick={() => approvePlan(sessionId, request.id, "default")}>
            Approve, ask before edits
          </button>
          <button type="button" class="plan-send" disabled={sendable.length === 0} onClick={() => decide(sessionId, request.id, { behavior: "deny", message: planComments(sendable) })}>
            Send {sendable.length} {sendable.length === 1 ? "comment" : "comments"}, keep planning
          </button>
        </div>
      ) : null}
    </aside>
  );
}
