import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { PermissionDecision, PermissionMode, PermissionRequest } from "../../../src/chat/protocol";
import { RECOMMENDED, questionsOf, type AskQuestion } from "../plan";
import { post, setUi } from "../store";
import "./permission.css";

export function decide(sessionId: string, id: string, decision: PermissionDecision): void {
  post({ type: "permission", sessionId, id, decision });
}

export function approvePlan(sessionId: string, id: string, mode: PermissionMode): void {
  post({ type: "setPermissionMode", sessionId, mode });
  decide(sessionId, id, { behavior: "allow" });
}

type IconName = "terminal" | "file" | "plug" | "plan" | "question";

const ICONS: Record<IconName, string> = {
  terminal: "M4 17l6-6-6-6M12 19h8",
  file: "M14 3H6v18h12V7zM14 3v4h4",
  plug: "M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3",
  plan: "M9 4h6M9 4a2 2 0 0 0-2 2h10a2 2 0 0 0-2-2M7 6H5v15h14V6h-2M9 12h6M9 16h4",
  question: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

function toolTitle(toolName: string): { title: string; icon: IconName } {
  if (toolName === "Bash") {
    return { title: "Run a command?", icon: "terminal" };
  }
  if (toolName === "Write") {
    return { title: "Write a file?", icon: "file" };
  }
  if (toolName === "Edit" || toolName === "MultiEdit" || toolName === "NotebookEdit") {
    return { title: "Edit a file?", icon: "file" };
  }
  return { title: `Use ${toolName.replace(/^mcp__/, "").replace(/__/g, " · ")}?`, icon: "plug" };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function ToolBody({ request }: { request: PermissionRequest }) {
  const { input } = request;
  const command = text(input.command);
  const path = text(input.file_path) ?? text(input.notebook_path);
  return (
    <>
      {request.toolName === "Bash" && command ? <pre class="perm-code">{command}</pre> : null}
      {request.toolName === "Bash" && text(input.description) ? <div class="perm-note">{text(input.description)}</div> : null}
      {request.toolName !== "Bash" && path ? <code class="perm-path">{path}</code> : null}
      {request.toolName !== "Bash" && !path ? <pre class="perm-code">{JSON.stringify(input).slice(0, 600)}</pre> : null}
      {request.decisionReason ? <div class="perm-note">{request.decisionReason}</div> : null}
      {request.blockedPath ? <div class="perm-note">Blocked path <code>{request.blockedPath}</code></div> : null}
    </>
  );
}

function Shell({ title, icon, compact, onEnter, children, actions }: { title: string; icon: IconName; compact?: boolean; onEnter?: () => void; children?: ComponentChildren; actions: ComponentChildren }) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && event.target === event.currentTarget) {
      onEnter?.();
    }
  };
  return (
    <div class={`perm-card${compact ? " compact" : ""}`} role="group" aria-label={title} tabIndex={onEnter ? 0 : undefined} onKeyDown={onKeyDown}>
      <div class="perm-main">
        <div class="perm-title">
          <Icon name={icon} />
          {title}
        </div>
        {children}
      </div>
      <div class="perm-actions">{actions}</div>
    </div>
  );
}

function ToolCard({ sessionId, request, compact }: { sessionId: string; request: PermissionRequest; compact?: boolean }) {
  const [instead, setInstead] = useState("");
  const { title, icon } = toolTitle(request.toolName);
  const allowOnce = () => decide(sessionId, request.id, { behavior: "allow" });
  const sendInstead = (event: Event) => {
    event.preventDefault();
    if (instead.trim()) {
      decide(sessionId, request.id, { behavior: "deny", message: instead.trim() });
    }
  };
  return (
    <Shell
      title={title}
      icon={icon}
      compact={compact}
      onEnter={allowOnce}
      actions={
        <>
          <button type="button" class="primary" onClick={allowOnce}>
            Allow once <span class="perm-key">⏎</span>
          </button>
          {request.alwaysLabel ? (
            <button type="button" onClick={() => decide(sessionId, request.id, { behavior: "allow", always: true })}>
              Always allow <code class="muted">{request.alwaysLabel}</code>
            </button>
          ) : null}
          <button type="button" onClick={() => decide(sessionId, request.id, { behavior: "deny", message: "The user denied this." })}>
            Deny
          </button>
        </>
      }
    >
      <ToolBody request={request} />
      {compact ? null : (
        <form class="perm-instead" onSubmit={sendInstead}>
          <label for={`perm-instead-${request.id}`}>Or tell Claude what to do instead</label>
          <input id={`perm-instead-${request.id}`} type="text" value={instead} onInput={(event) => setInstead(event.currentTarget.value)} />
        </form>
      )}
    </Shell>
  );
}

const CHECK = "M5 12.5l4.5 4.5L19 7.5";

interface Choice {
  picked: string[];
  other: string;
  otherOn: boolean;
  note: string;
  noteOpen: boolean;
}

function answerOf(question: AskQuestion, choice: Choice): string {
  const parts = [...choice.picked];
  if (choice.otherOn && choice.other.trim()) {
    parts.push(choice.other.trim());
  }
  return parts.join(", ");
}

function Tick() {
  return (
    <svg class="q-tick" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true">
      <path d={CHECK} />
    </svg>
  );
}

function QuestionBlock({ id, index, question, choice, compact, onChange, onPicked }: { id: string; index: number; question: AskQuestion; choice: Choice; compact?: boolean; onChange: (choice: Choice) => void; onPicked: () => void }) {
  const name = `${id}-${index}`;
  const multi = question.multiSelect === true;
  const pick = (label: string, on: boolean) => {
    if (!multi) {
      onChange({ ...choice, picked: [label], otherOn: false });
      onPicked();
      return;
    }
    onChange({ ...choice, picked: on ? [...choice.picked, label] : choice.picked.filter((item) => item !== label) });
  };
  const type = multi ? "checkbox" : "radio";
  return (
    <fieldset class="q-question">
      <legend>
        <span class="q-header">{question.header}</span>
        <span class="q-text">{question.question}</span>
        {multi ? <span class="q-hint">Pick any</span> : null}
      </legend>
      {question.options.map((option, optionIndex) => {
        const on = choice.picked.includes(option.label);
        const recommended = RECOMMENDED.test(option.label);
        return (
          <label class={`q-option${on ? " on" : ""}`} key={option.label}>
            <input type={type} name={name} checked={on} onChange={(event) => pick(option.label, event.currentTarget.checked)} />
            <span class="q-key" aria-hidden="true">{optionIndex + 1}</span>
            <span class="q-body">
              <span class="q-label">
                {option.label.replace(RECOMMENDED, "")}
                {recommended ? <span class="q-badge">Recommended</span> : null}
              </span>
              {option.description ? <span class="q-desc">{option.description}</span> : null}
            </span>
            {on ? <Tick /> : null}
          </label>
        );
      })}
      <div class={`q-option q-other${choice.otherOn ? " on" : ""}`}>
        <span class="q-key" aria-hidden="true">{question.options.length + 1}</span>
        <input
          type="text"
          aria-label={`Other answer for ${question.header}`}
          placeholder="Something else…"
          value={choice.other}
          onInput={(event) => {
            const other = event.currentTarget.value;
            onChange({ ...choice, other, otherOn: other.trim() !== "", picked: multi ? choice.picked : [] });
          }}
        />
      </div>
      {compact ? null : choice.noteOpen ? (
        <input
          type="text"
          class="q-note"
          aria-label={`Note for ${question.header}`}
          placeholder="Note for Claude"
          value={choice.note}
          autoFocus
          onInput={(event) => onChange({ ...choice, note: event.currentTarget.value })}
        />
      ) : (
        <button type="button" class="q-add-note" onClick={() => onChange({ ...choice, noteOpen: true })}>
          + Add a note to this answer
        </button>
      )}
    </fieldset>
  );
}

function QuestionCard({ sessionId, request, compact }: { sessionId: string; request: PermissionRequest; compact?: boolean }) {
  const questions = questionsOf(request.input);
  const [choices, setChoices] = useState<Choice[]>(() => questions.map(() => ({ picked: [], other: "", otherOn: false, note: "", noteOpen: false })));
  const [active, setActive] = useState(0);
  const card = useRef<HTMLDivElement>(null);
  const answers = questions.map((question, index) => answerOf(question, choices[index]));
  const missing = questions.find((_, index) => answers[index] === "");
  const answered = answers.filter(Boolean).length;

  useEffect(() => {
    const focused = document.activeElement;
    const typing = (focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement) && focused.value !== "";
    if (!typing) {
      card.current?.focus({ preventScroll: true });
    }
  }, []);

  const send = () => {
    if (missing) {
      return;
    }
    const answerMap = Object.fromEntries(questions.map((question, index) => [question.question, answers[index]]));
    const notes = questions.flatMap((question, index) => (choices[index].note.trim() ? [[question.question, { notes: choices[index].note.trim() }]] : []));
    const updatedInput = { ...request.input, answers: answerMap, ...(notes.length > 0 ? { annotations: Object.fromEntries(notes) } : {}) };
    decide(sessionId, request.id, { behavior: "allow", updatedInput });
  };
  const skip = () => decide(sessionId, request.id, { behavior: "deny", message: "The user skipped these questions. Use your best judgement." });
  const change = (index: number, choice: Choice) => setChoices((current) => current.map((entry, i) => (i === index ? choice : entry)));
  const advance = (from: number) => {
    const next = questions.findIndex((_, index) => index > from && answers[index] === "");
    if (next !== -1) {
      setActive(next);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.type === "text") {
      if (event.key === "Enter") {
        event.preventDefault();
        send();
      } else if (event.key === "Escape") {
        card.current?.focus();
      }
      return;
    }
    const question = questions[active];
    const digit = Number(event.key);
    if (question && Number.isInteger(digit) && digit >= 1 && digit <= question.options.length + 1) {
      event.preventDefault();
      const inputs = card.current?.querySelectorAll<HTMLInputElement>(".q-question input");
      const input = inputs?.[digit - 1];
      if (input?.type === "text") {
        input.focus();
      } else {
        input?.click();
      }
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(Math.min(questions.length - 1, Math.max(0, active + (event.key === "ArrowDown" ? 1 : -1))));
    } else if (event.key === "Enter") {
      event.preventDefault();
      send();
    } else if (event.key === "Escape") {
      event.preventDefault();
      skip();
    }
  };

  return (
    <div class={`perm-card question${compact ? " compact" : ""}`} role="group" aria-label="Claude has questions" tabIndex={0} ref={card} onKeyDown={onKeyDown}>
      <div class="q-head">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d={ICONS.question} />
        </svg>
        <span class="q-title">{questions.length > 1 ? `Claude has ${questions.length} questions` : "Claude has a question"}</span>
        {questions.length > 1 ? (
          <span class="q-progress">
            {questions.map((_, index) => (
              <span key={index} class={answers[index] ? "done" : undefined} />
            ))}
            {answered} of {questions.length}
          </span>
        ) : null}
      </div>
      {questions.map((question, index) =>
        index === active || questions.length === 1 ? (
          <QuestionBlock key={question.question} id={request.id} index={index} question={question} choice={choices[index]} compact={compact} onChange={(choice) => change(index, choice)} onPicked={() => advance(index)} />
        ) : (
          <button type="button" key={question.question} class="q-row" onClick={() => setActive(index)}>
            {answers[index] ? <Tick /> : <span class="q-dot" />}
            <span class="q-header">{question.header}</span>
            <span class={`q-row-text${answers[index] ? "" : " muted"}`}>{answers[index] ? answers[index].replace(RECOMMENDED, "") : question.question}</span>
            <span class="q-row-action">{answers[index] ? "Change" : "Answer"}</span>
          </button>
        )
      )}
      <div class="perm-actions">
        <button type="button" class="primary" disabled={!!missing} title={missing ? `Answer "${missing.header}" to send` : undefined} onClick={send}>
          {questions.length > 1 ? "Send answers" : "Send answer"} <span class="perm-key">⏎</span>
        </button>
        <button type="button" onClick={skip}>
          Skip, Claude decides
        </button>
        {compact ? null : <span class="q-keys">{missing && answered > 0 ? `Answer "${missing.header}" to send` : "1–9 pick · ↑↓ question · Esc skip"}</span>}
      </div>
    </div>
  );
}

function PlanCard({ sessionId, request, compact }: { sessionId: string; request: PermissionRequest; compact?: boolean }) {
  return (
    <Shell
      title="Plan ready for review"
      icon="plan"
      compact={compact}
      actions={
        <>
          <button type="button" class={compact ? "" : "primary"} onClick={() => setUi(sessionId, { side: "plan" })}>
            Open plan
          </button>
          {compact ? (
            <>
              <button type="button" class="primary" onClick={() => approvePlan(sessionId, request.id, "acceptEdits")}>
                Approve, accept edits
              </button>
              <button type="button" onClick={() => approvePlan(sessionId, request.id, "default")}>
                Approve, ask before edits
              </button>
            </>
          ) : null}
        </>
      }
    />
  );
}

export function PermissionCard({ sessionId, request, compact }: { sessionId: string; request: PermissionRequest; compact?: boolean }) {
  if (request.toolName === "AskUserQuestion") {
    return <QuestionCard sessionId={sessionId} request={request} compact={compact} />;
  }
  if (request.toolName === "ExitPlanMode") {
    return <PlanCard sessionId={sessionId} request={request} compact={compact} />;
  }
  return <ToolCard sessionId={sessionId} request={request} compact={compact} />;
}
