import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ChangeScope, DiffLine, FileChange } from "../../../src/chat/protocol";
import { highlightCode, languageFor } from "../highlight";
import { renderMarkdown } from "../markdown";
import {
  addReply,
  addThread,
  counts,
  deriveTurns,
  draftComments,
  markSent,
  removeTurn,
  setDraftText,
  setResolved,
  toComment,
  type ReviewThread,
  type TurnView
} from "../review";
import { sessionFiles } from "../sessionFiles";
import { getState, post, setUi, updateReview, useSession } from "../store";
import { prLabel } from "./Header";
import { Composer } from "./Composer";
import { Transcript } from "./Transcript";
import "./review.css";

const SCOPES: { scope: ChangeScope; label: string }[] = [
  { scope: "session", label: "This session" },
  { scope: "base", label: "All vs main" },
  { scope: "turn", label: "Last turn" },
  { scope: "uncommitted", label: "Uncommitted" }
];

const STATUS_BADGE: Record<string, string> = { added: "A", deleted: "D", renamed: "R" };
const FOCUSABLE = 'button:not(:disabled), textarea, input, select, summary, a[href], [tabindex]:not([tabindex="-1"])';

interface Anchor {
  side: "old" | "new";
  no: number;
}

interface Jump extends Anchor {
  path: string;
}

function basename(file: string): { dir: string; name: string } {
  const slash = file.lastIndexOf("/");
  return { dir: file.slice(0, slash + 1), name: file.slice(slash + 1) };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function anchorOf(line: DiffLine): Anchor | undefined {
  if (line.kind === "gap") return undefined;
  if (line.kind === "del") return line.oldNo === undefined ? undefined : { side: "old", no: line.oldNo };
  return line.newNo === undefined ? undefined : { side: "new", no: line.newNo };
}

const isAt = (thread: ReviewThread, anchor?: Anchor) => anchor !== undefined && thread.side === anchor.side && thread.line === anchor.no;

function Spinner() {
  return <span class="spinner" aria-hidden="true" />;
}

function FileList({ files, current, counts: perFile, onSelect }: { files: FileChange[]; current?: string; counts: Map<string, number>; onSelect(path: string): void }) {
  return (
    <nav class="review-files" aria-label="Changed files">
      {files.map((file) => {
        const { dir, name } = basename(file.path);
        const comments = perFile.get(file.path);
        return (
          <button type="button" key={file.path} class="review-file" aria-current={file.path === current} title={file.path} onClick={() => onSelect(file.path)}>
            <span class="review-file-name">
              <span class="review-file-base">{name}</span>
              {dir && <span class="review-file-dir">{dir}</span>}
            </span>
            {STATUS_BADGE[file.status] && <span class="review-badge">{STATUS_BADGE[file.status]}</span>}
            {comments && <span class="review-file-comments">{comments}</span>}
          </button>
        );
      })}
    </nav>
  );
}

interface ThreadActions {
  onDraft(threadId: string, turnId: string, text: string): void;
  onCancel(threadId: string, turnId: string): void;
  onReply(threadId: string, text: string): void;
  onResolve(threadId: string, resolved: boolean): void;
  onView(thread: ReviewThread): void;
}

function Draft({ thread, turnId, text, actions }: { thread: ReviewThread; turnId: string; text: string; actions: ThreadActions }) {
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => input.current?.focus(), []);
  const id = `review-draft-${turnId}`;
  return (
    <div class="review-turn">
      <label for={id} class="review-who">
        Comment on {thread.side === "old" ? "deleted " : ""}line {thread.line}
      </label>
      <textarea id={id} ref={input} rows={2} value={text} onInput={(event) => actions.onDraft(thread.id, turnId, event.currentTarget.value)} />
      <div class="review-box-actions">
        <span class="muted review-hint">Sent with ⌘⏎</span>
        <button type="button" onClick={() => actions.onCancel(thread.id, turnId)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ClaudeReply({ view }: { view?: TurnView }) {
  if (view?.state !== "answered") {
    return (
      <div class="review-claude review-working" role="status">
        <Spinner />
        <span class="review-claude-name">Claude</span>
        is fixing this…
      </div>
    );
  }
  const body = <div class="review-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(view.reply ?? "") }} />;
  return (
    <div class="review-claude">
      <div class="review-who">
        <span class="review-claude-name">Claude</span>· replied
      </div>
      {view.inChat ? (
        <details>
          <summary>Claude replied in chat</summary>
          {body}
        </details>
      ) : (
        body
      )}
    </div>
  );
}

function ReplyBox({ thread, onReply }: { thread: ReviewThread; onReply(threadId: string, text: string): void }) {
  const [text, setText] = useState("");
  const id = `review-reply-${thread.id}`;
  return (
    <form
      class="review-reply"
      onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim()) return;
        onReply(thread.id, text.trim());
        setText("");
      }}
    >
      <label for={id} class="sr-only">
        Reply to Claude
      </label>
      <input id={id} type="text" value={text} placeholder="Reply to Claude…" onInput={(event) => setText(event.currentTarget.value)} />
    </form>
  );
}

function Thread({ thread, views, actions }: { thread: ReviewThread; views: Map<string, TurnView>; actions: ThreadActions }) {
  const last = thread.turns[thread.turns.length - 1];
  if (thread.resolved) {
    return (
      <div class="review-thread review-resolved">
        <span class="muted review-resolved-text">Resolved · line {thread.line} · {thread.turns[0].text}</span>
        <button type="button" class="ghost" onClick={() => actions.onResolve(thread.id, false)}>
          Reopen
        </button>
      </div>
    );
  }
  return (
    <div class="review-thread" data-thread={thread.id}>
      {thread.turns.map((turn) => {
        const view = views.get(turn.id);
        if (!turn.sent) {
          return <Draft key={turn.id} thread={thread} turnId={turn.id} text={turn.text} actions={actions} />;
        }
        return (
          <div class="review-turn" key={turn.id}>
            <div class="review-who">
              <span class="review-you">You</span>· {thread.side === "old" ? "deleted " : ""}line {thread.line}
              <span class="review-pill">{view?.state === "answered" ? "Answered" : "Sent to Claude"}</span>
            </div>
            <div class="review-text-body">{turn.text}</div>
            <ClaudeReply view={view} />
          </div>
        );
      })}
      {last.sent && views.get(last.id)?.state === "answered" && (
        <div class="review-turn">
          <div class="review-actions">
            <button type="button" onClick={() => actions.onView(thread)}>
              View change
            </button>
            <button type="button" onClick={() => actions.onResolve(thread.id, true)}>
              Resolve
            </button>
          </div>
          <ReplyBox thread={thread} onReply={actions.onReply} />
        </div>
      )}
    </div>
  );
}

interface DiffRowsProps {
  path: string;
  lines: DiffLine[];
  html: string[];
  threads: ReviewThread[];
  views: Map<string, TurnView>;
  actions: ThreadActions;
  onOpen(anchor: Anchor, code: string): void;
}

function DiffRows({ path, lines, html, threads, views, actions, onOpen }: DiffRowsProps) {
  const anchors = lines.map(anchorOf);
  const orphans = threads.filter((thread) => !anchors.some((anchor) => isAt(thread, anchor)));
  return (
    <div class="review-lines">
      {orphans.map((thread) => (
        <Thread key={thread.id} thread={thread} views={views} actions={actions} />
      ))}
      {lines.map((line, index) => {
        if (line.kind === "gap") {
          return <div class="review-gap">… {line.text}</div>;
        }
        const anchor = anchors[index];
        const here = threads.filter((thread) => isAt(thread, anchor));
        return (
          <div key={index} data-line={anchor && `${path}:${anchor.side}:${anchor.no}`}>
            <div
              class={`review-line review-k-${line.kind}${anchor ? " review-commentable" : ""}${here.length > 0 ? " review-commented" : ""}`}
              onClick={() => anchor && here.length === 0 && !window.getSelection()?.toString() && onOpen(anchor, line.text)}
            >
              {anchor ? (
                <button type="button" class="review-plus" aria-label={`Comment on line ${anchor.no}`}>
                  +
                </button>
              ) : (
                <span class="review-plus" />
              )}
              <span class="review-no">{anchor?.no}</span>
              <span class="review-sign">{line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}</span>
              <span class="review-text" dangerouslySetInnerHTML={{ __html: html[index] }} />
            </div>
            {here.map((thread) => (
              <Thread key={thread.id} thread={thread} views={views} actions={actions} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function ReviewPane({ sessionId }: { sessionId: string }) {
  const { ui, changes, diffs, meta, messages, review } = useSession(sessionId);
  const dialog = useRef<HTMLElement>(null);
  const lastBase = useRef("main");
  const [jump, setJump] = useState<Jump>();
  const [focusLine, setFocusLine] = useState<number>();
  const scope = ui.reviewScope;
  const status = meta?.status;
  const tabs = ui.prUrl ? [...SCOPES, { scope: "pr" as ChangeScope, label: `PR ${prLabel({ key: "", url: ui.prUrl })}` }] : SCOPES;
  const edited = useMemo(() => sessionFiles(messages, meta?.cwd), [messages, meta?.cwd]);
  const scopeFiles = { worktree: ui.worktree, ...(scope === "session" ? { files: edited } : scope === "pr" ? { prUrl: ui.prUrl } : {}) };
  const close = () => setUi(sessionId, { side: "details" });

  useEffect(() => post({ type: "changes", sessionId, scope, ...scopeFiles }), [sessionId, scope, ui.prUrl, ui.worktree, status]);

  const loaded = changes?.scope === scope && changes.worktree === ui.worktree && (scope !== "pr" || changes.prUrl === ui.prUrl) ? changes : undefined;
  const files = loaded?.files ?? [];
  if (changes?.base) {
    lastBase.current = changes.base.replace(/^origin\//, "");
  }
  const current = files.find((file) => file.path === ui.reviewFile)?.path;

  useEffect(() => {
    if (!loaded) return;
    if (current) {
      post({ type: "fileDiff", sessionId, scope, path: current, ...scopeFiles });
    } else if (files.length > 0) {
      setUi(sessionId, { reviewFile: files[0].path });
    }
  }, [loaded, current]);

  useEffect(() => setFocusLine(undefined), [current]);

  const diff = current ? diffs[current] : undefined;
  const shown = diff && diff.path === current ? diff : undefined;
  const html = useMemo(() => shown?.lines.map((line) => highlightCode(line.text, languageFor(shown.path))) ?? [], [shown]);

  useEffect(() => {
    if (!jump || shown?.path !== jump.path) return;
    const target = dialog.current?.querySelector(`[data-line="${CSS.escape(`${jump.path}:${jump.side}:${jump.no}`)}"]`);
    target?.scrollIntoView({ block: "center" });
    setJump(undefined);
  }, [jump, shown]);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => before?.focus?.();
  }, []);

  const views = useMemo(() => deriveTurns(messages, review), [messages, review]);
  const total = counts(review.threads, views);
  const totalAdded = files.reduce((sum, file) => sum + file.added, 0);
  const totalRemoved = files.reduce((sum, file) => sum + file.removed, 0);
  const perFile = new Map<string, number>();
  review.threads.forEach((thread) => perFile.set(thread.path, (perFile.get(thread.path) ?? 0) + 1));
  const drafts = draftComments(review);

  const sendBatch = (comments: ReturnType<typeof draftComments>) => {
    const from = getState().sessions[sessionId]?.messages.length ?? 0;
    post({ type: "sendComments", sessionId, comments });
    updateReview(sessionId, (current) => markSent(current, comments.map((comment) => comment.id), from));
  };

  const actions: ThreadActions = {
    onDraft: (threadId, turnId, text) => updateReview(sessionId, (r) => setDraftText(r, threadId, turnId, text)),
    onCancel: (threadId, turnId) => updateReview(sessionId, (r) => removeTurn(r, threadId, turnId)),
    onResolve: (threadId, resolved) => updateReview(sessionId, (r) => setResolved(r, threadId, resolved)),
    onReply: (threadId, text) => {
      const { review: next, turn } = addReply(getState().sessions[sessionId].review, threadId, text);
      const thread = next.threads.find((candidate) => candidate.id === threadId)!;
      updateReview(sessionId, () => next);
      sendBatch([toComment(thread, turn)]);
    },
    onView: (thread) => {
      post({ type: "changes", sessionId, scope, ...scopeFiles });
      post({ type: "fileDiff", sessionId, scope, path: thread.path, ...scopeFiles });
      setUi(sessionId, { reviewFile: thread.path });
      setJump({ path: thread.path, side: thread.side, no: thread.line });
    }
  };

  const open = (anchor: Anchor, code: string) => {
    updateReview(sessionId, (r) => addThread(r, { path: current!, line: anchor.no, side: anchor.side, code }).review);
    setFocusLine(anchor.no);
  };

  const selectFile = (path: string) => setUi(sessionId, { reviewFile: path });

  const nextChange = () => {
    if (files.length === 0) return;
    const index = files.findIndex((file) => file.path === current);
    selectFile(files[(index + 1) % files.length].path);
  };

  const openInEditor = () => {
    if (!current) return;
    const firstAdd = shown?.lines.find((line) => line.kind === "add")?.newNo;
    post({ type: "openFile", sessionId, path: current, line: focusLine ?? firstAdd, worktree: ui.worktree });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const inChat = (event.target as HTMLElement).closest(".review-chat");
    if (event.key === "Escape" && !(inChat && status === "working")) {
      event.preventDefault();
      close();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !inChat) {
      event.preventDefault();
      if (drafts.length > 0) sendBatch(drafts);
    } else if (event.key === "Tab") {
      const items = [...(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((item) => item.offsetParent !== null);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const keys = useRef(onKeyDown);
  keys.current = onKeyDown;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keys.current(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  const summary =
    total.sent === 0
      ? "No comments sent yet"
      : `${plural(total.sent, "comment")} sent · ${total.answered} answered · ${total.progress} in progress`;

  return (
    <div class="review-overlay">
      <section class="review" role="dialog" aria-modal="true" aria-label="Review changes" tabIndex={-1} ref={dialog}>
        <div class="review-head">
          <span class="review-title">Review changes</span>
          {ui.worktree ? <span class="mono muted" title={ui.worktree}>{ui.worktree.split("/").pop()}</span> : meta?.branch && <span class="mono muted">{meta.branch}</span>}
          <div class="review-tabs" role="tablist" aria-label="Which changes">
            {tabs.map((item) => (
              <button type="button" key={item.scope} role="tab" aria-selected={item.scope === scope} onClick={() => setUi(sessionId, { reviewScope: item.scope })}>
                {item.scope === "base" ? `All vs ${lastBase.current}` : item.label}
              </button>
            ))}
          </div>
          <span class="review-total muted">
            <span class="review-add">+{totalAdded}</span> <span class="review-del">−{totalRemoved}</span> in {plural(files.length, "file")}
          </span>
          {total.progress > 0 && status === "working" && (
            <span class="review-status" role="status">
              <Spinner />
              Claude is addressing {plural(total.progress, "comment")}
            </span>
          )}
          <button type="button" class="review-close" aria-label="Close review and return to chat" onClick={close}>
            Back to chat · Esc
          </button>
        </div>

        {changes?.error && <div class="review-error">{changes.error}</div>}

        <div class="review-body">
          <div class="review-main">
            {!changes?.error && !loaded && <div class="review-empty muted">Loading changes…</div>}
            {!changes?.error && loaded && files.length === 0 && <div class="review-empty muted">No changes.</div>}
            {files.length > 0 && <FileList files={files} current={current} counts={perFile} onSelect={selectFile} />}
            {files.length > 0 && (
              <div class="review-diff">
                {current && (
                  <div class="review-diff-head">
                    <span class="mono">{current}</span>
                    <button type="button" onClick={openInEditor}>
                      Open in editor
                    </button>
                  </div>
                )}
                {current && shown && (
                  <DiffRows
                    path={current}
                    lines={shown.lines}
                    html={html}
                    threads={review.threads.filter((thread) => thread.path === current)}
                    views={views}
                    actions={actions}
                    onOpen={open}
                  />
                )}
              </div>
            )}
          </div>
          <aside class="review-chat" aria-label="Review conversation">
            <div class="section-label review-chat-head">Chat · same session</div>
            <Transcript sessionId={sessionId} compact />
            <Composer sessionId={sessionId} compact />
          </aside>
        </div>

        <div class="review-foot">
          <span class="muted review-summary">{summary}</span>
          <button type="button" class="review-next" disabled={files.length < 2} onClick={nextChange}>
            Next change
          </button>
          <button type="button" class="primary" disabled={drafts.length === 0} onClick={() => sendBatch(drafts)}>
            Send new comments to Claude <span class="review-key">⌘⏎</span>
          </button>
        </div>
      </section>
    </div>
  );
}
