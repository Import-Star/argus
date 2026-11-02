import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { collectHooks, eventLine } from "../src/chat/panels/hooks.ts";
import { addRule, collectRules, removeRule } from "../src/chat/panels/permissions.ts";
import { parseSettings, writeSettings, type SettingsFile } from "../src/chat/settingsJson.ts";

const file = (label: string, json: Record<string, unknown>): SettingsFile => ({ label, description: "", file: `/${label}.json`, json });

describe("permission rules", () => {
  it("merges rules from every file and keeps their source", () => {
    const rules = collectRules([file("user", { permissions: { allow: ["A"], additionalDirectories: ["/x"] } }), file("local", { permissions: { allow: ["B"], deny: ["C"] } }), file("empty", {})]);
    assert.deepEqual(rules.allow.map((rule) => [rule.text, rule.label]), [["A", "user"], ["B", "local"]]);
    assert.deepEqual(rules.deny.map((rule) => rule.text), ["C"]);
    assert.deepEqual(rules.folders.map((rule) => rule.text), ["/x"]);
  });

  it("adds and removes a rule without touching other keys", () => {
    const json = { model: "m", permissions: { allow: ["A"], defaultMode: "plan" } };
    const added = addRule(json, "ask", " Bash(ls) ");
    assert.deepEqual(added, { model: "m", permissions: { allow: ["A"], defaultMode: "plan", ask: ["Bash(ls)"] } });
    assert.deepEqual(removeRule(added, "allow", "A"), { model: "m", permissions: { allow: [], defaultMode: "plan", ask: ["Bash(ls)"] } });
    assert.equal(addRule(added, "ask", "Bash(ls)"), added);
    assert.equal(removeRule(json, "deny", "nope"), json);
  });

  it("writes folders under additionalDirectories", () => {
    assert.deepEqual(addRule({}, "folders", "/y"), { permissions: { additionalDirectories: ["/y"] } });
  });
});

describe("settings files", () => {
  it("reports invalid JSON instead of treating it as empty", () => {
    assert.equal(parseSettings("{nope").error !== undefined, true);
    assert.equal(parseSettings("[]").error, "Not a JSON object");
    assert.deepEqual(parseSettings(undefined), { json: {} });
  });

  it("creates the folder and writes indented JSON with a newline", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-settings-"));
    const target = path.join(dir, ".claude", "settings.local.json");
    writeSettings(target, addRule({}, "allow", "A"));
    assert.equal(fs.readFileSync(target, "utf8"), '{\n  "permissions": {\n    "allow": [\n      "A"\n    ]\n  }\n}\n');
    fs.rmSync(dir, { recursive: true });
  });
});

describe("hooks", () => {
  it("groups by event and matcher across files", () => {
    const groups = collectHooks([
      file("user", { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "a", timeout: 5 }] }], Stop: [{ hooks: [{ command: "s" }] }] } }),
      file("project", { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "b" }] }, { matcher: "Edit", hooks: [{ command: "c" }] }] } })
    ]);
    assert.deepEqual(groups.map((group) => group.event), ["PreToolUse", "Stop"]);
    assert.deepEqual(groups[0].matchers.map((entry) => [entry.matcher, entry.hooks.map((hook) => hook.command)]), [["Bash", ["a", "b"]], ["Edit", ["c"]]]);
    assert.equal(groups[0].matchers[0].hooks[0].timeout, 5);
    assert.equal(groups[1].matchers[0].matcher, "");
  });

  it("ignores malformed hook entries and finds an event's line", () => {
    assert.deepEqual(collectHooks([file("a", { hooks: { Stop: "x", Pre: [null, { hooks: "y" }] } })]), []);
    assert.equal(eventLine('{\n  "hooks": {\n    "Stop": []\n  }\n}', "Stop"), 2);
  });
});
