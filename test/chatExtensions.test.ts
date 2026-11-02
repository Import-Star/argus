import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChatExtensionRegistry } from "../src/services/chatExtensions.ts";

const script = { fsPath: "/plugins/x/chat.js" } as never;

describe("ChatExtensionRegistry", () => {
  it("only lets data: and blob: into the chat's media CSP", () => {
    const registry = new ChatExtensionRegistry();
    registry.register({ id: "a", script, media: ["data:", "https://evil.example" as never] });
    registry.register({ id: "b", script, media: ["blob:", "data:"] });
    assert.deepEqual(registry.media(), ["data:", "blob:"]);
  });

  it("rejects bad and duplicate ids", () => {
    const registry = new ChatExtensionRegistry();
    registry.register({ id: "a", script });
    assert.throws(() => registry.register({ id: "a", script }));
    assert.throws(() => registry.register({ id: "Bad id", script }));
  });

  it("keeps going when an extension's onMessage throws", async () => {
    const warnings: string[] = [];
    const registry = new ChatExtensionRegistry((message) => warnings.push(message));
    registry.register({ id: "a", script, onMessage: () => { throw new Error("boom"); } });
    await registry.receive("a", {}, () => {});
    assert.match(warnings[0], /boom/);
  });

  it("stops posting once disposed", () => {
    const registry = new ChatExtensionRegistry();
    const posted: unknown[] = [];
    registry.onDidPost((_id, message) => posted.push(message));
    const handle = registry.register({ id: "a", script });
    handle.post(1);
    handle.dispose();
    handle.post(2);
    assert.deepEqual(posted, [1]);
  });
});
