import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MessageQueue } from "../chat/host/messageQueue.ts";
import type { QueueEntry } from "../chat/host/messageQueue.ts";

function setup() {
  const cli: QueueEntry[] = [];
  const echoed: string[] = [];
  let interrupts = 0;
  let shown: string[] = [];
  const queue = new MessageQueue({
    submit: (entry) => void cli.push({ ...entry }),
    cancel: async (uuid) => {
      const at = cli.findIndex((entry) => entry.uuid === uuid);
      if (at >= 0) cli.splice(at, 1);
      return at >= 0;
    },
    interrupt: async () => void interrupts++,
    started: (entry) => void echoed.push(entry.text),
    changed: (items) => void (shown = items.map((item) => (item.sent ? `${item.text}!` : item.text)))
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
  const take = (text: string) => {
    const entry = cli.splice(cli.findIndex((candidate) => candidate.text === text), 1)[0];
    queue.onLifecycle(entry.uuid, "started");
  };
  return { queue, cli, echoed, settle, take, shown: () => shown, interrupts: () => interrupts };
}

describe("MessageQueue", () => {
  it("lists what was added and marks a message consumed when the CLI starts it", async () => {
    const t = setup();
    t.queue.add("a", []);
    t.queue.add("b", []);
    await t.settle();
    assert.deepEqual(t.shown(), ["a", "b"]);
    t.take("a");
    assert.deepEqual(t.echoed, ["a"]);
    assert.deepEqual(t.queue.items().map((item) => item.text), ["b"]);
  });

  it("edits a message in place and keeps the CLI order", async () => {
    const t = setup();
    ["a", "b", "c"].forEach((text) => t.queue.add(text, []));
    await t.settle();
    t.queue.act(t.queue.items()[1].id, "edit", "b2");
    await t.settle();
    assert.deepEqual(t.shown(), ["a", "b2", "c"]);
    assert.deepEqual(t.cli.map((entry) => entry.text), ["a", "b2", "c"]);
  });

  it("moves a message down and up", async () => {
    const t = setup();
    ["a", "b", "c"].forEach((text) => t.queue.add(text, []));
    await t.settle();
    t.queue.act(t.queue.items()[0].id, "down");
    await t.settle();
    assert.deepEqual(t.cli.map((entry) => entry.text), ["b", "a", "c"]);
    t.queue.act(t.queue.items()[2].id, "up");
    await t.settle();
    assert.deepEqual(t.cli.map((entry) => entry.text), ["b", "c", "a"]);
    assert.deepEqual(t.shown(), ["b", "c", "a"]);
  });

  it("removes a message from the CLI queue", async () => {
    const t = setup();
    ["a", "b"].forEach((text) => t.queue.add(text, []));
    await t.settle();
    t.queue.act(t.queue.items()[0].id, "remove");
    await t.settle();
    assert.deepEqual(t.cli.map((entry) => entry.text), ["b"]);
    assert.deepEqual(t.shown(), ["b"]);
  });

  it("flags a message the CLI already took and refuses to change it", async () => {
    const t = setup();
    ["a", "b"].forEach((text) => t.queue.add(text, []));
    await t.settle();
    const [a] = t.queue.items();
    t.cli.shift();
    t.queue.act(a.id, "remove");
    await t.settle();
    assert.deepEqual(t.shown(), ["a!", "b"]);
    t.queue.act(a.id, "edit", "nope");
    await t.settle();
    assert.deepEqual(t.shown(), ["a!", "b"]);
  });

  it("keeps a handed-off message first when a move would pass it", async () => {
    const t = setup();
    ["a", "b", "c"].forEach((text) => t.queue.add(text, []));
    await t.settle();
    t.cli.shift();
    t.queue.act(t.queue.items()[1].id, "up");
    await t.settle();
    assert.deepEqual(t.shown(), ["a!", "b", "c"]);
    assert.deepEqual(t.cli.map((entry) => entry.text), ["b", "c"]);
  });

  it("send now puts the message first and interrupts", async () => {
    const t = setup();
    ["a", "b", "c"].forEach((text) => t.queue.add(text, []));
    await t.settle();
    t.queue.act(t.queue.items()[2].id, "sendNow");
    await t.settle();
    assert.deepEqual(t.cli.map((entry) => entry.text), ["c", "a", "b"]);
    assert.equal(t.interrupts(), 1);
  });

  it("drops a message the CLI starts while a change is waiting on the cancel", async () => {
    const t = setup();
    ["a", "b"].forEach((text) => t.queue.add(text, []));
    await t.settle();
    const [a] = t.queue.items();
    t.queue.act(a.id, "edit", "a2");
    t.take("a");
    await t.settle();
    assert.deepEqual(t.echoed, ["a"]);
    assert.deepEqual(t.shown(), ["b"]);
    assert.deepEqual(t.cli.map((entry) => entry.text), ["b"]);
  });

  it("flushes at the end of a turn only when the CLI never reports lifecycle", async () => {
    const t = setup();
    t.queue.add("a", []);
    await t.settle();
    t.queue.turnEnded();
    await t.settle();
    assert.deepEqual(t.echoed, ["a"]);
    const u = setup();
    u.queue.add("a", []);
    await u.settle();
    u.queue.onLifecycle("other", "queued");
    u.queue.turnEnded();
    await u.settle();
    assert.deepEqual(u.echoed, []);
  });
});
