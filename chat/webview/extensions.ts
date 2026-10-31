/// <reference path="../../api/webview.d.ts" />
import { useEffect, useState } from "preact/hooks";
import { post } from "./store";

export interface ReplyAction extends ArgusReplyAction {
  key: string;
}

const ID = /^[a-z0-9-]{1,64}$/;
const modules = new Map<string, ArgusChatExtensionModule>();
let actions: ReplyAction[] = [];
const listeners = new Set<() => void>();

function guard(id: string, what: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    console.error(`Argus: chat extension "${id}" ${what} threw:`, error);
  }
}

function setActions(next: ReplyAction[]): void {
  actions = next;
  listeners.forEach((listener) => listener());
}

window.argusChat = {
  registerExtension(id, extension) {
    if (!ID.test(id) || modules.has(id)) {
      console.error(`Argus: chat extension id ${JSON.stringify(id)} is invalid or already registered.`);
      return;
    }
    modules.set(id, extension);
    guard(id, "mount", () =>
      extension.mount({
        post: (message) => post({ type: "extension", id, message }),
        addReplyAction: (action) => {
          const entry = { ...action, key: `${id}:${action.id}` };
          setActions([...actions.filter((existing) => existing.key !== entry.key), entry]);
          return { dispose: () => setActions(actions.filter((existing) => existing !== entry)) };
        }
      })
    );
  }
};

export function onExtensionMessage(id: string, message: unknown): void {
  const extension = modules.get(id);
  if (extension?.onMessage) {
    guard(id, "onMessage", () => extension.onMessage!(message));
  }
}

export function runReplyAction(action: ReplyAction, button: HTMLElement, markdown: string): void {
  const transcript = button.closest<HTMLElement>(".chat-transcript");
  const element = button.closest(".tr-reply")?.querySelector<HTMLElement>(".tr-text");
  const overlay = transcript?.querySelector<HTMLElement>(":scope > .chat-overlay");
  if (!transcript || !element || !overlay) {
    return;
  }
  const setActive = (active: boolean) => {
    button.dataset.active = String(active);
    const title = active && action.activeTitle ? action.activeTitle : action.title;
    button.title = title;
    button.setAttribute("aria-label", title);
  };
  guard(action.key.split(":")[0], "onClick", () => action.onClick({ sessionId: transcript.dataset.session ?? "", markdown, element, overlay, setActive }));
}

export function useReplyActions(): ReplyAction[] {
  const [, rerender] = useState(0);
  useEffect(() => {
    const listener = () => rerender((count) => count + 1);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
  return actions;
}
