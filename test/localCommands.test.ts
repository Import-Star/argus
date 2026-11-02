import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentSlug, chromeArgs, parseLocalCommand, parseToggle, withLocalCommands } from "../src/chat/localCommands.ts";

describe("parseLocalCommand", () => {
  it("finds local commands, aliases and their arguments", () => {
    assert.deepEqual(parseLocalCommand("/remote-control"), { name: "remote-control", args: "" });
    assert.deepEqual(parseLocalCommand("  /rc off "), { name: "remote-control", args: "off" });
    assert.deepEqual(parseLocalCommand("/add-dir ../other folder"), { name: "add-dir", args: "../other folder" });
    assert.deepEqual(parseLocalCommand("/Chrome on"), { name: "chrome", args: "on" });
  });

  it("leaves commands Claude handles, and plain text, alone", () => {
    assert.equal(parseLocalCommand("/compact"), undefined);
    assert.equal(parseLocalCommand("please run /chrome"), undefined);
    assert.equal(parseLocalCommand("/chromeish"), undefined);
  });
});

describe("bare-only commands", () => {
  it("handles the bare command and sends it to Claude when it has arguments", () => {
    assert.deepEqual(parseLocalCommand("/mcp"), { name: "mcp", args: "" });
    assert.deepEqual(parseLocalCommand("/model"), { name: "model", args: "" });
    assert.equal(parseLocalCommand("/model opus"), undefined);
    assert.equal(parseLocalCommand("/config autoCompact=false"), undefined);
    assert.deepEqual(parseLocalCommand("/permissions extra"), { name: "permissions", args: "extra" });
    assert.deepEqual(parseLocalCommand("/fork"), { name: "branch", args: "" });
  });
});

describe("withLocalCommands", () => {
  it("adds the local commands once, replacing an SDK command of the same name", () => {
    const merged = withLocalCommands([
      { name: "compact", description: "c", argumentHint: "" },
      { name: "chrome", description: "sdk", argumentHint: "" }
    ]);
    assert.equal(merged[0].name, "compact");
    assert.equal(merged.filter((command) => command.name === "chrome").length, 1);
    assert.notEqual(merged.find((command) => command.name === "chrome")?.description, "sdk");
    assert.ok(merged.some((command) => command.name === "remote-control"));
  });
});

describe("parseToggle", () => {
  it("toggles with no argument and reads on/off words", () => {
    assert.equal(parseToggle("", false), true);
    assert.equal(parseToggle("", true), false);
    assert.equal(parseToggle("ON", false), true);
    assert.equal(parseToggle("off", true), false);
    assert.equal(parseToggle("maybe", true), undefined);
  });
});

describe("chromeArgs", () => {
  it("maps the choice to CLI flags and leaves the default alone when unset", () => {
    assert.deepEqual(chromeArgs(undefined), {});
    assert.deepEqual(chromeArgs(true), { chrome: null });
    assert.deepEqual(chromeArgs(false), { "no-chrome": null });
  });
});

describe("agentSlug", () => {
  it("makes a file-safe hyphenated name", () => {
    assert.equal(agentSlug("  Code Reviewer! "), "code-reviewer");
    assert.equal(agentSlug("!!!"), "");
  });
});
