import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentsBusy, inhibitorCommand } from "../src/services/keepAwakeCommand.ts";

describe("agentsBusy", () => {
  it("is busy while a session is working or scheduled", () => {
    assert.equal(agentsBusy(["idle", "working"]), true);
    assert.equal(agentsBusy(["scheduled"]), true);
  });
  it("is not busy when sessions are idle, waiting on you or done", () => {
    assert.equal(agentsBusy(["idle", "needs-you", "pr-open", "archived"]), false);
    assert.equal(agentsBusy([]), false);
  });
});

describe("inhibitorCommand", () => {
  it("uses a PowerShell power request on Windows that watches the parent pid", () => {
    const command = inhibitorCommand("win32", 4242, true)!;
    assert.equal(command.command, "powershell.exe");
    const script = Buffer.from(command.args.at(-1)!, "base64").toString("utf16le");
    assert.match(script, /SetThreadExecutionState\(\[uint32\]2147483651\)/);
    assert.match(script, /Get-Process -Id 4242/);
  });
  it("leaves the screen flag off on Windows when asked", () => {
    const script = Buffer.from(inhibitorCommand("win32", 1, false)!.args.at(-1)!, "base64").toString("utf16le");
    assert.match(script, /\[uint32\]2147483649\)/);
  });
  it("uses caffeinate tied to the parent on macOS", () => {
    assert.deepEqual(inhibitorCommand("darwin", 7, true)!.args, ["-dim", "-w", "7"]);
    assert.deepEqual(inhibitorCommand("darwin", 7, false)!.args, ["-im", "-w", "7"]);
  });
  it("uses systemd-inhibit on Linux and exits with the parent", () => {
    const command = inhibitorCommand("linux", 9, true)!;
    assert.equal(command.command, "systemd-inhibit");
    assert.ok(command.args.includes("--what=idle:sleep"));
    assert.match(command.args.at(-1)!, /kill -0 9 /);
  });
  it("returns nothing on unsupported platforms", () => {
    assert.equal(inhibitorCommand("aix", 1, true), undefined);
  });
});
