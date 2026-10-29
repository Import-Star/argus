import type { ChatDetailsItem, ChatDetailsProvider, ChatDetailsSection, SessionCard } from "../types";

const ID = /^[a-z0-9-]{1,64}$/;
const MAX_ITEMS = 40;
const MAX_OPTIONS = 200;
const MAX_TEXT = 500;

// A plugin section as the chat webview gets it: `key` routes actions back to the provider that made it.
export interface ChatPluginSection {
  key: string;
  title: string;
  items: ChatDetailsItem[];
}

// Backs ArgusApi.registerChatDetails. No vscode import, so it is unit tested.
export class ChatDetailsRegistry {
  private readonly providers = new Map<number, ChatDetailsProvider>();
  private readonly listeners = new Set<() => void>();
  private next = 0;
  private readonly warn: (message: string) => void;

  public constructor(warn: (message: string) => void = (message) => console.warn(message)) {
    this.warn = warn;
  }

  public register(provider: ChatDetailsProvider): { dispose(): void; refresh(): void } {
    const n = this.next++;
    this.providers.set(n, provider);
    return {
      dispose: () => {
        this.providers.delete(n);
        this.fire();
      },
      refresh: () => this.fire()
    };
  }

  public onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  public sectionsFor(card: SessionCard): ChatPluginSection[] {
    const out: ChatPluginSection[] = [];
    for (const [n, provider] of this.providers) {
      let sections: ChatDetailsSection[] | undefined;
      try {
        sections = provider.sections(card);
      } catch (error) {
        this.warn(`Argus: a chat details provider threw: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      for (const section of sections ?? []) {
        if (!section || !ID.test(section.id)) {
          this.warn(`Argus: skipped a chat details section with an invalid id: ${JSON.stringify(section?.id)}.`);
          continue;
        }
        out.push({ key: `${n}:${section.id}`, title: text(section.title), items: (section.items ?? []).slice(0, MAX_ITEMS).flatMap(clean) });
      }
    }
    return out;
  }

  public async action(sessionId: string, key: string, itemId: string, value?: string): Promise<void> {
    const match = /^(\d+):([a-z0-9-]+)$/.exec(key);
    const provider = match && this.providers.get(Number(match[1]));
    if (!match || !provider?.onAction) {
      return;
    }
    await provider.onAction(sessionId, match[2], itemId, value);
  }

  private fire(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_TEXT) : "";
}

// Keeps only well-formed items, so a plugin's mistake can't break the pane.
function clean(item: ChatDetailsItem): ChatDetailsItem[] {
  switch (item?.type) {
    case "row":
      return [{ type: "row", label: text(item.label), value: text(item.value), ...(item.tooltip ? { tooltip: text(item.tooltip) } : {}) }];
    case "note":
      return [{ type: "note", text: text(item.text) }];
    case "select": {
      const options = (item.options ?? []).slice(0, MAX_OPTIONS).map((option) => ({ value: text(option.value), label: text(option.label) }));
      return ID.test(item.id) && options.length > 0 ? [{ type: "select", id: item.id, label: text(item.label), value: text(item.value), options }] : [];
    }
    case "button":
      return ID.test(item.id) ? [{ type: "button", id: item.id, label: text(item.label) }] : [];
    default:
      return [];
  }
}
