import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findClaude, installerShell, isOlder, parseVersion, releaseUrl } from "../src/services/claudeCli.ts";

const nowhere = () => undefined;

describe("findClaude", () => {
  it("uses the configured path first", () => {
    assert.equal(findClaude("/opt/claude", "linux", () => "/usr/bin/claude", () => true), "/opt/claude");
  });
  it("treats a configured path that's gone as not installed", () => {
    assert.equal(findClaude("/opt/claude", "linux", () => "/usr/bin/claude", () => false), undefined);
  });
  it("then claude on the PATH, by the platform's executable name", () => {
    const names: string[] = [];
    assert.equal(findClaude("", "win32", (name) => (names.push(name), "C:\\bin\\claude.exe")), "C:\\bin\\claude.exe");
    findClaude("", "darwin", (name) => (names.push(name), undefined), () => false, "/Users/me");
    assert.deepEqual(names, ["claude.exe", "claude"]);
  });
  it("then the native installer's folder", () => {
    assert.equal(findClaude("", "darwin", nowhere, (file) => file === "/Users/me/.local/bin/claude", "/Users/me"), "/Users/me/.local/bin/claude");
    assert.equal(findClaude("", "win32", nowhere, (file) => file === "C:\\Users\\me\\.local\\bin\\claude.exe", "C:\\Users\\me"), "C:\\Users\\me\\.local\\bin\\claude.exe");
  });
  it("finds nothing when Claude Code isn't installed", () => {
    assert.equal(findClaude("", "linux", nowhere, () => false, "/home/me"), undefined);
  });
});

describe("installerShell", () => {
  it("runs Anthropic's PowerShell installer on Windows", () => {
    const shell = installerShell("win32");
    assert.equal(shell.shellPath, "powershell.exe");
    assert.equal(shell.command, "irm https://claude.ai/install.ps1 | iex");
    assert.equal(shell.shellArgs.at(-1), shell.command);
    assert.ok(shell.shellArgs.includes("-NoExit"));
  });
  it("runs the shell installer elsewhere and leaves a shell open", () => {
    const shell = installerShell("darwin");
    assert.equal(shell.command, "curl -fsSL https://claude.ai/install.sh | bash");
    assert.equal(shell.shellArgs[0], "-c");
    assert.ok(shell.shellArgs[1].startsWith(`${shell.command}; exec `));
  });
});

describe("isOlder", () => {
  it("compares each part as a number", () => {
    assert.equal(isOlder("2.1.99", "2.1.314"), true);
    assert.equal(isOlder("2.1.314", "2.1.314"), false);
    assert.equal(isOlder("2.2.0", "2.1.314"), false);
  });
});

describe("parseVersion", () => {
  it("finds the version in `claude --version` output", () => {
    assert.equal(parseVersion("2.1.314 (Claude Code)\n"), "2.1.314");
    assert.equal(parseVersion("not a version"), undefined);
  });
});

describe("releaseUrl", () => {
  it("uses the stable channel only when asked for it", () => {
    assert.ok(releaseUrl("stable").endsWith("/stable"));
    assert.ok(releaseUrl(undefined).endsWith("/latest"));
  });
});
