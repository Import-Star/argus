import { randomUUID } from "crypto";
import type { QueuedMessage, WebviewMessage } from "../../src/chat/protocol";

export interface QueuedImage {
  mediaType: string;
  data: string;
}

export interface QueueEntry {
  id: string;
  uuid: string;
  text: string;
  images: QueuedImage[];
  sent: boolean;
}

export interface QueueBackend {
  submit(entry: QueueEntry): void;
  cancel(uuid: string): Promise<boolean>;
  interrupt(): Promise<unknown>;
  started(entry: QueueEntry): void;
  changed(items: QueuedMessage[]): void;
}

export type QueueAction = Extract<WebviewMessage, { type: "queue" }>["action"];

export class MessageQueue {
  private entries: QueueEntry[] = [];
  private chain: Promise<void> = Promise.resolve();
  private lifecycle = false;
  private readonly backend: QueueBackend;

  constructor(backend: QueueBackend) {
    this.backend = backend;
  }

  public items(): QueuedMessage[] {
    return this.entries.map(({ id, text, images, sent }) => ({ id, text, images: images.length, sent }));
  }

  public add(text: string, images: QueuedImage[]): void {
    this.run(async () => {
      const entry = { id: randomUUID(), uuid: randomUUID(), text, images, sent: false };
      this.entries.push(entry);
      this.backend.submit(entry);
    });
  }

  public act(id: string, action: QueueAction, text?: string): void {
    this.run(() => this.apply(id, action, text));
  }

  // A CLI without command_lifecycle never says when a message started, so the end of the turn is the closest signal.
  public turnEnded(): void {
    if (!this.lifecycle) {
      this.run(async () => this.entries.splice(0).forEach((entry) => this.backend.started(entry)));
    }
  }

  public onLifecycle(uuid: string, state: string): void {
    this.lifecycle = true;
    if (state === "started") {
      const entry = this.entries.find((candidate) => candidate.uuid === uuid);
      if (entry) {
        this.entries = this.entries.filter((candidate) => candidate !== entry);
        this.backend.started(entry);
        this.emit();
      }
    }
  }

  public clear(): void {
    this.entries = [];
    this.emit();
  }

  private run(step: () => Promise<void>): void {
    this.chain = this.chain.then(step).then(() => this.emit(), () => this.emit());
  }

  private emit(): void {
    this.backend.changed(this.items());
  }

  private async apply(id: string, action: QueueAction, text?: string): Promise<void> {
    const index = this.entries.findIndex((entry) => entry.id === id);
    const entry = this.entries[index];
    if (!entry || entry.sent) {
      return;
    }
    const order = [...this.entries];
    if (action === "edit") {
      order[index] = { ...entry, text: text ?? entry.text };
    } else if (action === "remove") {
      order.splice(index, 1);
    } else if (action === "sendNow") {
      order.splice(index, 1);
      order.unshift(entry);
    } else {
      const to = action === "up" ? index - 1 : index + 1;
      if (!order[to] || order[to].sent) {
        return;
      }
      [order[index], order[to]] = [order[to], order[index]];
    }
    await this.resubmit(order);
    if (action === "sendNow") {
      await this.backend.interrupt();
    }
  }

  // The CLI queue is first-in-first-out, so changing one message means withdrawing it and everything behind it.
  private async resubmit(order: QueueEntry[]): Promise<void> {
    const first = order.findIndex((entry, at) => entry !== this.entries[at]);
    const start = first < 0 ? Math.min(order.length, this.entries.length) : first;
    const old = this.entries.slice(start);
    const withdrawn = await Promise.all(old.map((entry) => (entry.sent ? false : this.backend.cancel(entry.uuid))));
    const stuck = old.filter((_, at) => !withdrawn[at]);
    stuck.forEach((entry) => (entry.sent = true));
    const gone = new Set(old.filter((_, at) => withdrawn[at]).map((entry) => entry.id));
    const redo = order.slice(start).filter((entry) => gone.has(entry.id));
    const alive = new Set(this.entries.map((entry) => entry.id));
    redo.forEach((entry) => (entry.uuid = randomUUID()));
    this.entries = [...this.entries.slice(0, start), ...stuck, ...redo].filter((entry) => alive.has(entry.id));
    redo.filter((entry) => alive.has(entry.id)).forEach((entry) => this.backend.submit(entry));
  }
}
