import { createPortal } from "preact/compat";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { renderMarkdownBlocks } from "../markdown";
import { lastPlan, planComments, type PlanComment as Comment } from "../plan";
import { setUi, useSession } from "../store";
import { approvePlan, keepPlanning } from "./PermissionCard";
import { AddComment, commentHolder, removeHolder, useHighlight, useTextSelection, type TextSelection } from "./selectionComment";
import { onLinkClick } from "./SideQuestion";
import "./plan.css";

type PlanComment = Comment & { range: Range; holder: HTMLElement };

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

export function PlanPane({ sessionId }: { sessionId: string }) {
  const session = useSession(sessionId);
  const request = session.permissions.find((item) => item.toolName === "ExitPlanMode");
  const plan = typeof request?.input.plan === "string" ? request.input.plan : lastPlan(session.messages);
  const blocks = useMemo(() => renderMarkdownBlocks(plan ?? ""), [plan]);
  const { selection, onMouseUp, clear } = useTextSelection(".plan-block", request !== undefined);
  const [comments, setComments] = useState<PlanComment[]>([]);
  const [editing, setEditing] = useState<number>();
  const nextId = useRef(1);
  const sendable = comments.filter((comment) => comment.text !== "");

  useEffect(() => setComments([]), [plan]);

  useHighlight(useMemo(() => comments.map((comment) => comment.range), [comments]));

  const addComment = (picked: TextSelection) => {
    const id = nextId.current++;
    setComments([...comments, { id, quote: picked.quote, range: picked.range, holder: commentHolder(picked.range), text: "" }]);
    setEditing(id);
    clear();
  };

  const remove = (id: number) => {
    const holder = comments.find((comment) => comment.id === id)?.holder;
    if (holder) removeHolder(holder);
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
      <div class="plan-body" onMouseUp={onMouseUp} onClick={onLinkClick}>
        {blocks.length === 0 ? <div class="muted">No plan yet.</div> : null}
        {blocks.map((block, index) => (
          <div class="plan-block tr-text" key={index} dangerouslySetInnerHTML={{ __html: block.html }} />
        ))}
        {comments.map((comment) =>
          createPortal(<CommentCard key={comment.id} comment={comment} editing={editing === comment.id} onSave={(text) => save(comment.id, text)} onEdit={() => setEditing(comment.id)} onRemove={() => remove(comment.id)} />, comment.holder)
        )}
        <AddComment selection={selection} onAdd={addComment} />
      </div>
      {request ? (
        <div class="plan-foot">
          <button type="button" class="primary" onClick={() => approvePlan(sessionId, request.id, "acceptEdits")}>
            Approve, accept edits
          </button>
          <button type="button" onClick={() => approvePlan(sessionId, request.id, "default")}>
            Approve, ask before edits
          </button>
          <button type="button" class="plan-send" onClick={() => keepPlanning(sessionId, request.id, sendable.length ? planComments(sendable) : undefined)}>
            {sendable.length ? `Send ${sendable.length} ${sendable.length === 1 ? "comment" : "comments"}, keep planning` : "Keep planning"}
          </button>
        </div>
      ) : null}
    </aside>
  );
}
