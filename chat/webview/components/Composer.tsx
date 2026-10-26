import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { EffortLevel, PermissionMode } from "../../../src/chat/protocol";
import { post, useSession } from "../store";
import { fenceFile, fileUris, filterCommands, isTextLike, MAX_TEXT_BYTES, uriToPath } from "./composerLogic";
import { Queue } from "./Queue";
import "./composer.css";

const EFFORT_LABELS: Record<EffortLevel, string> = { low: "Low", medium: "Med", high: "High", xhigh: "XHigh", max: "Max" };
const ALL_EFFORTS = Object.keys(EFFORT_LABELS) as EffortLevel[];

const MODES: { value: PermissionMode; label: string }[] = [
  { value: "default", label: "Ask before edits" },
  { value: "acceptEdits", label: "Accept edits" },
  { value: "plan", label: "Plan" },
  { value: "auto", label: "Auto" }
];

const SLASH = /^\/(\S*)$/;
const MENTION = /(^|\s)@([^\s@]*)$/;

interface Mention {
  query: string;
  start: number;
  end: number;
}

interface Doc {
  name: string;
  text: string;
}

interface Attachment {
  mediaType: string;
  data: string;
}

function PaperclipIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M21 12.5l-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.3-8.3" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

function Pick({ label, value, onChange, class: extra, children, text }: { label: string; value: string; onChange(value: string): void; class?: string; children: ComponentChildren; text: string }) {
  return (
    <label class={`cmp-pill${extra ? ` ${extra}` : ""}`}>
      <span class="cmp-pill-text">{text}</span>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true">
        <path d="M6 9l6 6 6-6" />
      </svg>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        {children}
      </select>
    </label>
  );
}

export function Composer({ sessionId, compact }: { sessionId: string; compact?: boolean }) {
  const { meta, fileSuggestions } = useSession(sessionId);
  const [text, setText] = useState("");
  const [images, setImages] = useState<Attachment[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [note, setNote] = useState("");
  const [slashOff, setSlashOff] = useState(false);
  const [mention, setMention] = useState<Mention>();
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const suggestTimer = useRef<number>();

  const working = meta?.status === "working";
  const model = meta?.models.find((option) => option.value === meta.model) ?? (meta?.model ? undefined : meta?.models[0]);
  // A model missing from the list (an explicit id) still gets the control; the CLI downgrades what it can't use.
  const efforts = model ? model.efforts : meta?.models.length ? ALL_EFFORTS : [];
  const suggestions = mention && fileSuggestions?.query === mention.query ? fileSuggestions.files : [];
  const slashQuery = !slashOff ? SLASH.exec(text)?.[1] : undefined;
  const commands = slashQuery === undefined ? [] : filterCommands(meta?.commands ?? [], slashQuery);
  const options = commands.length ? commands.map((command) => command.name) : suggestions;
  const typed = /^\/(\S+) $/.exec(text)?.[1];
  const hint = typed ? meta?.commands?.find((command) => command.name === typed)?.argumentHint : undefined;
  const chips = files.filter((file) => text.includes(`@${file}`));
  const canSend = text.trim().length > 0 || images.length > 0 || docs.length > 0;

  useEffect(() => {
    const el = input.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, compact ? 72 : 164)}px`;
    }
  }, [text, compact]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const focused = !compact || root.current?.contains(document.activeElement);
      if (focused && (event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "e" && efforts.length) {
        event.preventDefault();
        setEffort(efforts[(efforts.indexOf(meta?.effort as EffortLevel) + 1) % efforts.length]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function setEffort(effort: EffortLevel) {
    post({ type: "setEffort", sessionId, effort });
  }

  function submit() {
    if (!canSend) {
      return;
    }
    const body = [text.trim(), ...docs.map((doc) => fenceFile(doc.name, doc.text))].filter(Boolean).join("\n\n");
    post({ type: "send", sessionId, text: body, images: images.length ? images : undefined });
    setText("");
    setDocs([]);
    setNote("");
    setImages([]);
    setFiles([]);
    setMention(undefined);
  }

  function updateMention(value: string, caret: number) {
    const match = MENTION.exec(value.slice(0, caret));
    if (!match) {
      setMention(undefined);
      return;
    }
    const query = match[2];
    setMention({ query, start: caret - query.length - 1, end: caret });
    setActive(0);
    window.clearTimeout(suggestTimer.current);
    suggestTimer.current = window.setTimeout(() => post({ type: "fileSuggestions", sessionId, query }), 120);
  }

  function pickCommand(name: string) {
    setText(`/${name} `);
    requestAnimationFrame(() => input.current?.focus());
  }

  function addPaths(paths: string[]) {
    const mentions = paths.map((path) => `@${path} `).join("");
    setText((current) => `${current && !/\s$/.test(current) ? `${current} ` : current}${mentions}`);
    setFiles((current) => [...new Set([...current, ...paths])]);
  }

  async function addTextFiles(list: File[]) {
    for (const file of list) {
      if (!isTextLike(file)) {
        setNote(`Can't attach ${file.name}: only text and images`);
      } else if (file.size > MAX_TEXT_BYTES) {
        setNote(`Can't attach ${file.name}: over 200 KB`);
      } else {
        const content = await file.text();
        setDocs((current) => [...current, { name: file.name, text: content }]);
      }
    }
  }

  function attachImage(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      setImages((current) => [...current, { mediaType: file.type, data: url.slice(url.indexOf(",") + 1) }]);
    };
    reader.readAsDataURL(file);
  }

  function takeFiles(data: DataTransfer | null, event: Event) {
    if (!data) {
      return;
    }
    const paths = fileUris(data.getData("text/uri-list"))
      .map((uri) => uriToPath(uri, meta?.cwd ?? ""))
      .filter((path): path is string => Boolean(path));
    const dropped = [...data.files];
    if (!paths.length && !dropped.length) {
      return;
    }
    event.preventDefault();
    if (paths.length) {
      addPaths(paths);
      return;
    }
    setNote("");
    dropped.filter((file) => file.type.startsWith("image/")).forEach(attachImage);
    void addTextFiles(dropped.filter((file) => !file.type.startsWith("image/")));
  }

  function choose(index: number) {
    if (commands.length) {
      pickCommand(commands[index].name);
    } else {
      pick(suggestions[index]);
    }
  }

  function pick(path: string) {
    if (!mention) {
      return;
    }
    const insert = `@${path} `;
    setText(text.slice(0, mention.start) + insert + text.slice(mention.end));
    setFiles((current) => [...new Set([...current, path])]);
    setMention(undefined);
    const caret = mention.start + insert.length;
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(caret, caret);
    });
  }

  function removeFile(path: string) {
    setText(text.replace(`@${path} `, "").replace(`@${path}`, ""));
  }

  function addMention() {
    const el = input.current;
    const value = text && !/\s$/.test(text) ? `${text} @` : `${text}@`;
    setText(value);
    updateMention(value, value.length);
    el?.focus();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (options.length) {
      const move = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (move) {
        event.preventDefault();
        setActive((active + move + options.length) % options.length);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.isComposing) {
        event.preventDefault();
        choose(options[active] ? active : 0);
        return;
      }
    }
    if (event.key === "Escape") {
      if (commands.length) {
        setSlashOff(true);
      } else if (mention) {
        setMention(undefined);
      } else if (working) {
        post({ type: "interrupt", sessionId });
      }
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  function onPaste(event: ClipboardEvent) {
    takeFiles(event.clipboardData, event);
  }

  const modes = MODES.some((mode) => mode.value === meta?.permissionMode) || !meta ? MODES : [...MODES, { value: meta.permissionMode, label: meta.permissionMode }];
  const modeLabel = modes.find((mode) => mode.value === meta?.permissionMode)?.label;
  const models = meta ? (model || !meta.model ? meta.models : [...meta.models, { value: meta.model, displayName: meta.model, efforts: [] }]) : [];

  return (
    <div class="chat-composer" ref={root} data-compact={compact ? "true" : undefined}>
      <Queue sessionId={sessionId} />
      <div class="cmp-box">
        {commands.length > 0 && (
          <div class="cmp-suggest" role="listbox" aria-label="Commands">
            {commands.map((command, index) => (
              <div
                key={command.name}
                id={`cmp-${sessionId}-opt-${index}`}
                role="option"
                aria-selected={index === active}
                class={`cmp-option cmp-command${index === active ? " active" : ""}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pickCommand(command.name);
                }}
                onMouseEnter={() => setActive(index)}
              >
                <span class="mono">/{command.name}</span>
                {command.argumentHint && <span class="cmp-hint mono">{command.argumentHint}</span>}
                <span class="cmp-desc">{command.description}</span>
              </div>
            ))}
          </div>
        )}
        {commands.length === 0 && suggestions.length > 0 && (
          <div class="cmp-suggest" role="listbox" aria-label="Files">
            {suggestions.map((file, index) => (
              <div
                key={file}
                id={`cmp-${sessionId}-opt-${index}`}
                role="option"
                aria-selected={index === active}
                class={`cmp-option mono${index === active ? " active" : ""}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(file);
                }}
                onMouseEnter={() => setActive(index)}
              >
                {file}
              </div>
            ))}
          </div>
        )}
        {(chips.length > 0 || images.length > 0 || docs.length > 0) && (
          <div class="cmp-chips">
            {chips.map((file) => (
              <span class="cmp-chip mono" key={file}>
                {file.split("/").pop()}
                <button type="button" class="ghost" aria-label={`Remove ${file}`} onClick={() => removeFile(file)}>
                  ×
                </button>
              </span>
            ))}
            {docs.map((doc, index) => (
              <span class="cmp-chip mono" key={`${doc.name}:${index}`} title={`${doc.text.length} characters`}>
                {doc.name}
                <button type="button" class="ghost" aria-label={`Remove ${doc.name}`} onClick={() => setDocs(docs.filter((_, at) => at !== index))}>
                  ×
                </button>
              </span>
            ))}
            {images.map((image, index) => (
              <span class="cmp-chip cmp-image" key={index}>
                <img src={`data:${image.mediaType};base64,${image.data}`} alt={`Pasted image ${index + 1}`} />
                <button type="button" class="ghost" aria-label={`Remove image ${index + 1}`} onClick={() => setImages(images.filter((_, at) => at !== index))}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {note && (
          <div class="cmp-note" role="status">
            {note}
          </div>
        )}
        <label for={`cmp-${sessionId}`} class="sr-only">
          Message Claude
        </label>
        <textarea
          id={`cmp-${sessionId}`}
          ref={input}
          class="cmp-input"
          rows={compact ? 1 : 2}
          value={text}
          placeholder={hint ? hint : working ? "Queue a follow-up, @ to add files" : "Message Claude, @ to add files"}
          role={options.length ? "combobox" : undefined}
          aria-expanded={options.length ? true : undefined}
          aria-activedescendant={options.length ? `cmp-${sessionId}-opt-${active}` : undefined}
          onInput={(event) => {
            const el = event.currentTarget;
            setText(el.value);
            setSlashOff(false);
            setActive(0);
            setNote("");
            updateMention(el.value, el.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onDrop={(event) => takeFiles(event.dataTransfer, event)}
          onDragOver={(event) => event.dataTransfer?.types.includes("Files") && event.preventDefault()}
        />
        <div class="cmp-bar">
          <button type="button" class="ghost cmp-icon" aria-label="Add file" onClick={addMention}>
            <PaperclipIcon />
          </button>
          {meta && (
            <>
              <Pick label="Permission mode" text={modeLabel ?? meta.permissionMode} value={meta.permissionMode} onChange={(value) => post({ type: "setPermissionMode", sessionId, mode: value as PermissionMode })}>
                {modes.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </Pick>
              <Pick label="Model" text={models.find((option) => option.value === meta.model)?.displayName ?? meta.model ?? "Model"} value={meta.model ?? ""} onChange={(value) => post({ type: "setModel", sessionId, model: value })}>
                {models.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.displayName}
                  </option>
                ))}
              </Pick>
            </>
          )}
          {efforts.length > 0 && (
            <div class="cmp-effort" role="radiogroup" aria-label="Effort" title="Cmd/Ctrl+Shift+E to cycle">
              {!compact && <span class="cmp-effort-label">Effort</span>}
              {efforts.map((effort) => (
                <button key={effort} type="button" role="radio" aria-checked={effort === meta?.effort} class={effort === meta?.effort ? "on" : ""} onClick={() => setEffort(effort)}>
                  {EFFORT_LABELS[effort]}
                </button>
              ))}
            </div>
          )}
          <div class="cmp-end">
            {working && (
              <button type="button" class="cmp-stop" aria-label="Stop (Esc)" title="Stop (Esc)" onClick={() => post({ type: "interrupt", sessionId })}>
                <span />
              </button>
            )}
            {(canSend || !working) && (
              <button type="button" class="primary cmp-send" aria-label="Send" disabled={!canSend} onClick={submit}>
                <SendIcon />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
