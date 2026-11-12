import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanUserText, MAX_SHELL_OUTPUT, shellCommand, shellMessage, splitShell } from "../src/chat/conversationText.ts";

describe("shell mode", () => {
  it("reads the command from a ! prompt", () => {
    assert.equal(shellCommand("! npm test "), "npm test");
    assert.equal(shellCommand("!git status"), "git status");
    assert.equal(shellCommand("!  "), undefined);
    assert.equal(shellCommand("run !this"), undefined);
  });

  it("round-trips what Argus sends, with a prompt after held output", () => {
    const text = `${shellMessage("ls", "a\nb\n", "")}\n\nWhat changed?`;
    assert.deepEqual(splitShell(text), { blocks: [{ command: "ls", stdout: "a\nb\n", stderr: "" }], rest: "What changed?" });
    assert.equal(cleanUserText(text), "! ls\nWhat changed?");
  });

  it("joins output the CLI writes in its own message to the command before it", () => {
    assert.deepEqual(splitShell("<bash-stdout>ok</bash-stdout><bash-stderr>warn</bash-stderr>").blocks, [{ stdout: "ok", stderr: "warn" }]);
    assert.equal(cleanUserText("<bash-stdout>ok</bash-stdout><bash-stderr></bash-stderr>"), "");
  });

  it("keeps the end of long output", () => {
    const stdout = splitShell(shellMessage("x", `${"a".repeat(MAX_SHELL_OUTPUT)}END`, "")).blocks[0].stdout;
    assert.match(stdout, /^\[output truncated: 3 more characters not shown\]\n/);
    assert.ok(stdout.endsWith("END"));
  });
});
