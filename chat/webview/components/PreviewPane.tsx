import { useEffect, useMemo, useState } from "preact/hooks";
import { devServerUrls, isFramable, normalizeUrl } from "../previewUrls";
import { sessionArtifacts } from "../sessionArtifacts";
import { post, setUi, useSession } from "../store";
import "./preview.css";

interface Suggestion {
  url: string;
  label: string;
  kind: string;
}

function Icon({ children }: { children: preact.ComponentChildren }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: preact.ComponentChildren }) {
  return (
    <button type="button" class="pv-icon" title={label} aria-label={label} disabled={disabled} onClick={onClick}>
      <Icon>{children}</Icon>
    </button>
  );
}

function hostLabel(url: string): string {
  const parsed = new URL(url);
  return parsed.host + (parsed.pathname === "/" ? "" : parsed.pathname);
}

function Fallback({ url }: { url: string }) {
  return (
    <div class="pv-fallback">
      <p class="pv-fallback-title">{new URL(url).host} can't be shown here</p>
      <p class="muted">Most sites refuse to be framed, and the chat only frames localhost. Open it in VS Code's Simple Browser or your browser.</p>
      <div class="pv-fallback-actions">
        <button type="button" class="primary" onClick={() => post({ type: "openSimpleBrowser", url })}>
          Open in Simple Browser
        </button>
        <button type="button" onClick={() => post({ type: "openUrl", url })}>
          Open in browser
        </button>
      </div>
    </div>
  );
}

export function PreviewPane({ sessionId }: { sessionId: string }) {
  const { messages, ui } = useSession(sessionId);
  const url = ui.previewUrl;
  const [draft, setDraft] = useState(url ?? "");
  const [invalid, setInvalid] = useState(false);
  const [reloads, setReloads] = useState(0);
  useEffect(() => setDraft(url ?? ""), [url]);

  const suggestions = useMemo<Suggestion[]>(
    () => [
      ...devServerUrls(messages).map((found) => ({ url: found, label: hostLabel(found), kind: "Dev server" })),
      ...sessionArtifacts(messages).map((artifact) => ({ url: artifact.url, label: artifact.title, kind: "Artifact" }))
    ],
    [messages]
  );

  const go = (target: string) => {
    const normalized = normalizeUrl(target);
    setInvalid(!normalized);
    if (normalized) {
      setReloads(0);
      setUi(sessionId, { previewUrl: normalized });
    }
  };

  return (
    <section class="pv-pane" aria-label="Preview">
      <div class="pv-bar">
        <IconButton label="Reload" disabled={!url || !isFramable(url)} onClick={() => setReloads(reloads + 1)}>
          <path d="M21 12a9 9 0 1 1-3-6.7" />
          <path d="M21 4v5h-5" />
        </IconButton>
        <form
          class="pv-address"
          onSubmit={(event) => {
            event.preventDefault();
            go(draft);
          }}
        >
          <input class="mono" type="text" aria-label="Address" aria-invalid={invalid} placeholder="localhost:3000 or a URL" spellcheck={false} value={draft} onInput={(event) => setDraft(event.currentTarget.value)} />
        </form>
        <IconButton label="Open in Simple Browser" disabled={!url} onClick={() => url && post({ type: "openSimpleBrowser", url })}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18" />
        </IconButton>
        <IconButton label="Open in browser" disabled={!url} onClick={() => url && post({ type: "openUrl", url })}>
          <path d="M14 4h6v6" />
          <path d="M20 4l-9 9" />
          <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
        </IconButton>
        <IconButton label="Close preview" onClick={() => setUi(sessionId, { side: "details" })}>
          <path d="M6 6l12 12M18 6L6 18" />
        </IconButton>
      </div>
      {invalid && <p class="pv-error" role="alert">Enter a web address, a localhost URL or a port number.</p>}
      {suggestions.length > 0 && (
        <div class="pv-suggest" role="list" aria-label="Detected URLs">
          {suggestions.map((suggestion) => (
            <button key={suggestion.url} type="button" role="listitem" class="pv-chip" aria-pressed={suggestion.url === url} title={suggestion.url} onClick={() => go(suggestion.url)}>
              <span class="muted">{suggestion.kind}</span>
              <span class="mono">{suggestion.label}</span>
            </button>
          ))}
        </div>
      )}
      <div class="pv-body">
        {!url ? (
          <p class="pv-empty muted">Enter a URL, or pick a dev server or artifact from this chat.</p>
        ) : isFramable(url) ? (
          <iframe key={`${url}#${reloads}`} class="pv-frame" title="Preview" src={url} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals" />
        ) : (
          <Fallback url={url} />
        )}
      </div>
    </section>
  );
}
