import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hookedEvents } from "../src/services/HookInstaller.ts";

const ours = (command = '"/usr/bin/node" --no-warnings "/home/me/.claude/argus/session-tracker.ts"') => [{ hooks: [{ type: "command" as const, command }] }];

describe("hookedEvents", () => {
  it("finds nothing in empty settings", () => {
    assert.deepEqual(hookedEvents({}), []);
  });
  it("lists only events with an Argus hook", () => {
    const settings = { hooks: { SessionStart: ours(), Stop: ours("echo other"), UserPromptSubmit: ours("C:\Users\Me\.claude\argus\session-tracker.ts") } };
    assert.deepEqual(hookedEvents(settings), ["SessionStart", "UserPromptSubmit"]);
  });
  it("ignores events Argus doesn't use", () => {
    assert.deepEqual(hookedEvents({ hooks: { PreCompact: ours() } }), []);
  });
});
