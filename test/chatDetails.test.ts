import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionCard } from "../src/types.ts";
import { ChatDetailsRegistry } from "../src/services/chatDetails.ts";

const card = { record: { sessionId: "s1" } } as unknown as SessionCard;

describe("ChatDetailsRegistry", () => {
  it("keys sections by provider and routes actions back to the provider that made them", async () => {
    const registry = new ChatDetailsRegistry(() => {});
    const calls: unknown[] = [];
    registry.register({
      sections: () => [{ id: "time", title: "Time", items: [{ type: "select", id: "client", label: "Client", value: "a", options: [{ value: "a", label: "A" }] }] }],
      onAction: (...args) => void calls.push(args)
    });
    registry.register({ sections: () => [{ id: "time", title: "Other", items: [] }] });

    const sections = registry.sectionsFor(card);
    assert.deepEqual(sections.map((s) => s.key), ["0:time", "1:time"]);
    await registry.action("s1", "0:time", "client", "a");
    await registry.action("s1", "1:time", "client", "a"); // no onAction: ignored
    await registry.action("s1", "nonsense", "client");
    assert.deepEqual(calls, [["s1", "time", "client", "a"]]);
  });

  it("drops malformed sections and items, and survives a provider that throws", () => {
    const warnings: string[] = [];
    const registry = new ChatDetailsRegistry((m) => warnings.push(m));
    registry.register({ sections: () => { throw new Error("boom"); } });
    registry.register({
      sections: () => [
        { id: "Bad Id", title: "x", items: [] },
        {
          id: "ok",
          title: "OK",
          items: [
            { type: "row", label: "L", value: "V" },
            { type: "select", id: "empty", label: "S", value: "", options: [] },
            { type: "button", id: "Not valid", label: "B" },
            { type: "wat" } as never
          ]
        }
      ]
    });
    const sections = registry.sectionsFor(card);
    assert.deepEqual(sections, [{ key: "1:ok", title: "OK", items: [{ type: "row", label: "L", value: "V" }] }]);
    assert.equal(warnings.length, 2);
  });

  it("tells listeners on refresh and dispose", () => {
    const registry = new ChatDetailsRegistry(() => {});
    let fired = 0;
    registry.onDidChange(() => fired++);
    const handle = registry.register({ sections: () => [] });
    handle.refresh();
    handle.dispose();
    assert.equal(fired, 2);
    assert.deepEqual(registry.sectionsFor(card), []);
  });
});
