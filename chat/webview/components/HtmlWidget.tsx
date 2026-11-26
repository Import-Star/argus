import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { MAX_WIDGET_HEIGHT, WIDGET_SCRIPT_HOSTS } from "../../../src/chat/protocol";
import { widgetSrcdoc } from "../htmlWidget";
import { codeBlock } from "../markdown";
import { nonce } from "../nonce";
import { setUi } from "../store";
import type { Item } from "../transcript";
import "./htmlWidget.css";

function themeVars(): string {
  const computed = getComputedStyle(document.documentElement);
  return [...computed].filter((name) => name.startsWith("--vscode-")).map((name) => `${name}:${computed.getPropertyValue(name)}`).join(";");
}

export function HtmlWidget({ item, sessionId }: { item: Extract<Item, { kind: "html" }>; sessionId: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const [source, setSource] = useState(false);
  const srcdoc = useMemo(() => widgetSrcdoc(item.html, nonce, WIDGET_SCRIPT_HOSTS, themeVars(), getComputedStyle(document.body).colorScheme || "normal"), [item.html]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) {
        return;
      }
      const data = event.data as { argusWidget?: string; height?: unknown; text?: unknown } | null;
      if (data?.argusWidget === "height" && typeof data.height === "number") {
        setHeight(Math.min(data.height, MAX_WIDGET_HEIGHT));
      } else if (data?.argusWidget === "send" && typeof data.text === "string") {
        setUi(sessionId, { draft: data.text });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [sessionId]);

  return (
    <div class="tr-card html-widget">
      <div class="tr-head">
        <span class="mono">{item.title || "Widget"}</span>
        <span class="tr-spacer" />
        <button type="button" onClick={() => setSource(!source)}>
          {source ? "Show widget" : "Show source"}
        </button>
      </div>
      <iframe ref={frame} title={item.title || "Widget"} sandbox="allow-scripts" srcdoc={srcdoc} style={{ height: `${height}px` }} hidden={source} />
      {source && <div class="html-widget-source" dangerouslySetInnerHTML={{ __html: codeBlock(item.html, "html") }} />}
    </div>
  );
}
