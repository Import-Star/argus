import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { hookedEvents, refreshHookScript, trackingProblem } from "../src/services/HookInstaller.ts";

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

const EVENT_NAMES = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Notification", "Stop", "SubagentStart", "SubagentStop", "SessionEnd"];
const allHooked = (command?: string) => ({ hooks: Object.fromEntries(EVENT_NAMES.map((event) => [event, ours(command)])) });

describe("trackingProblem", () => {
  it("reports tracking off when nothing is hooked", () => {
    assert.equal(trackingProblem({}), "off");
  });
  it("reports a partial setup when a newer Argus hooks more events", () => {
    assert.equal(trackingProblem({ hooks: { SessionStart: ours(), Stop: ours() } }, () => true), "partial");
  });
  it("reports a missing Node when the hooks' Node is gone", () => {
    assert.equal(trackingProblem(allHooked(), () => false), "node-missing");
    assert.equal(trackingProblem(allHooked(), () => true), undefined);
  });
  it("can't check a bare node on PATH, so trusts it", () => {
    assert.equal(trackingProblem(allHooked('"node" --no-warnings "/home/me/.claude/argus/session-tracker.ts"'), () => false), undefined);
  });
});

describe("refreshHookScript", () => {
  const setup = (installed?: string, marker?: string) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "argus-hook-"));
    const source = path.join(root, "source.ts");
    const dir = path.join(root, "argus");
    fs.writeFileSync(source, "new");
    fs.mkdirSync(dir);
    if (installed !== undefined) fs.writeFileSync(path.join(dir, "session-tracker.ts"), installed);
    if (marker !== undefined) fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type: "module", version: marker }));
    return { source, dir, read: () => fs.readFileSync(path.join(dir, "session-tracker.ts"), "utf8") };
  };
  it("leaves a current script alone", () => {
    const { source, dir } = setup("new", "0.4.1");
    assert.equal(refreshHookScript(source, dir, "0.4.1"), "current");
  });
  it("replaces an older script and records the version", () => {
    const { source, dir, read } = setup("old");
    assert.equal(refreshHookScript(source, dir, "0.4.2"), "updated");
    assert.equal(read(), "new");
    const marker = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    assert.deepEqual(marker, { private: true, type: "module", version: "0.4.2" });
    assert.deepEqual(fs.readdirSync(dir).sort(), ["package.json", "session-tracker.ts"]);
  });
  it("installs a missing script", () => {
    const { source, dir, read } = setup();
    assert.equal(refreshHookScript(source, dir, "0.4.2"), "updated");
    assert.equal(read(), "new");
  });
  it("never replaces a script from a newer Argus", () => {
    const { source, dir, read } = setup("from 0.10", "0.10.0");
    assert.equal(refreshHookScript(source, dir, "0.9.9"), "newer");
    assert.equal(read(), "from 0.10");
  });
});
