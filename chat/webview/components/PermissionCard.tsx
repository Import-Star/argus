import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { PermissionDecision, PermissionMode, PermissionRequest } from "../../../src/chat/protocol";
import { questionsOf, type AskQuestion } from "../plan";
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

interface Choice {
  picked: string[];
  other: string;
  otherOn: boolean;
}

function answerOf(question: AskQuestion, choice: Choice): string {
  const parts = [...choice.picked];
  if (choice.otherOn && choice.other.trim()) {
    parts.push(choice.other.trim());
  }
  return parts.join(", ");
}

function QuestionBlock({ id, index, question, choice, onChange }: { id: string; index: number; question: AskQuestion; choice: Choice; onChange: (choice: Choice) => void }) {
  const name = `${id}-${index}`;
  const multi = question.multiSelect === true;
  const pick = (label: string, on: boolean) => {
    if (!multi) {
      onChange({ ...choice, picked: [label], otherOn: false });
      return;
    }
    onChange({ ...choice, picked: on ? [...choice.picked, label] : choice.picked.filter((item) => item !== label) });
  };
  const toggleOther = (on: boolean) => onChange({ ...choice, otherOn: on, picked: on && !multi ? [] : choice.picked });
  const type = multi ? "checkbox" : "radio";
  return (
    <fieldset class="perm-question">
      <legend>
        <span class="perm-chip">{question.header}</span>
        {question.question}
      </legend>
      {question.options.map((option) => (
        <label class="perm-option" key={option.label}>
          <input type={type} name={name} checked={choice.picked.includes(option.label)} onChange={(event) => pick(option.label, event.currentTarget.checked)} />
          <span>
            <span class="perm-option-label">{option.label}</span>
            {option.description ? <span class="perm-option-desc">{option.description}</span> : null}
          </span>
        </label>
      ))}
      <label class="perm-option">
        <input type={type} name={name} checked={choice.otherOn} onChange={(event) => toggleOther(event.currentTarget.checked)} />
        <span class="perm-option-label">Other</span>
        <input
          type="text"
          class="perm-other"
          aria-label={`Other answer for ${question.header}`}
          value={choice.other}
          onInput={(event) => onChange({ ...choice, other: event.currentTarget.value, otherOn: true, picked: multi ? choice.picked : [] })}
        />
      </label>
    </fieldset>
  );
}

function QuestionCard({ sessionId, request, compact }: { sessionId: string; request: PermissionRequest; compact?: boolean }) {
  const questions = questionsOf(request.input);
  const [choices, setChoices] = useState<Choice[]>(() => questions.map(() => ({ picked: [], other: "", otherOn: false })));
  const ready = questions.every((question, index) => answerOf(question, choices[index]) !== "");
  const send = () => {
    const answers = Object.fromEntries(questions.map((question, index) => [question.question, answerOf(question, choices[index])]));
    decide(sessionId, request.id, { behavior: "allow", updatedInput: { ...request.input, answers } });
  };
  const change = (index: number, choice: Choice) => setChoices(choices.map((current, i) => (i === index ? choice : current)));
  return (
    <Shell
      title={questions.length > 1 ? "Claude has questions" : "Claude has a question"}
      icon="question"
      compact={compact}
      actions={
        <>
          <button type="button" class="primary" disabled={!ready} onClick={send}>
            Send answer
          </button>
          <button type="button" onClick={() => decide(sessionId, request.id, { behavior: "deny", message: "The user declined to answer." })}>
            Skip
          </button>
        </>
      }
    >
      {questions.map((question, index) => (
        <QuestionBlock key={question.question} id={request.id} index={index} question={question} choice={choices[index]} onChange={(choice) => change(index, choice)} />
      ))}
    </Shell>
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
