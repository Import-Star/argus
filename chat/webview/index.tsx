import { render } from "preact";
import type { HostMessage } from "../../src/chat/protocol";
import { App } from "./App";
import "./chat.css";
import { startMermaid } from "./mermaid";
import { dispatch, post } from "./store";

window.addEventListener("message", (event: MessageEvent<HostMessage>) => dispatch(event.data));
render(<App />, document.getElementById("root")!);
post({ type: "ready" });
startMermaid();

// VS Code's webview drops Cmd+C, so copies go through the host clipboard.
function copy(text: string, button?: HTMLElement) {
  post({ type: "copy", text });
  if (button) {
    button.classList.add("copied");
    window.setTimeout(() => button.classList.remove("copied"), 1200);
  }
}

document.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>(".copy-btn");
  if (button) {
    copy(button.dataset.copy ?? button.closest(".code-block")?.querySelector("pre")?.textContent ?? "", button);
  }
});

document.addEventListener("keydown", (event) => {
  const field = document.activeElement?.closest("input, textarea");
  const text = window.getSelection()?.toString() ?? "";
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "c" && !field && text) {
    event.preventDefault();
    copy(text);
  }
});
