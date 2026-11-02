import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPlainOutput } from "../src/chat/commandOutput.ts";
import { parseConfigUsage } from "../src/chat/configUsage.ts";

describe("parseConfigUsage", () => {
  const usage = [
    "Usage: /config key=value [key=value ...]",
    "  verbose=true|false",
    "  editor=normal|vim",
    "  language=<value>",
    "  remoteControl=true|false|default",
    "  switchModelsOnFlag=Switch automatically|Ask each time"
  ].join("\n");

  it("sorts each setting into a toggle, a list or free text", () => {
    assert.deepEqual(parseConfigUsage(usage), [
      { key: "verbose", kind: "boolean", options: ["true", "false"] },
      { key: "editor", kind: "enum", options: ["normal", "vim"] },
      { key: "language", kind: "text", options: [] },
      { key: "remoteControl", kind: "enum", options: ["true", "false", "default"] },
      { key: "switchModelsOnFlag", kind: "enum", options: ["Switch automatically", "Ask each time"] }
    ]);
  });

  it("ignores the usage line", () => {
    assert.deepEqual(parseConfigUsage("Usage: /config key=value"), []);
  });
});

describe("isPlainOutput", () => {
  it("keeps space-aligned columns plain", () => {
    assert.equal(isPlainOutput("name      size\nfoo       12\nbar       3"), true);
  });

  it("leaves markdown to the markdown renderer", () => {
    assert.equal(isPlainOutput("## Context\n| a | b |\n|---|---|"), false);
    assert.equal(isPlainOutput("Current model: `Opus`"), false);
    assert.equal(isPlainOutput("**Bold** text"), false);
  });
});
