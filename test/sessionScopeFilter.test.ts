import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { normalize, parseScope, sessionFilter } from "../src/services/sessionScopeFilter.ts";

// One monorepo with two sibling folders, plus an unrelated repo and a worktree of the monorepo outside it.
const repo = path.resolve("/work/hub");
const argus = path.join(repo, "apps", "argus");
const website = path.join(repo, "apps", "website");
const other = path.resolve("/work/other");
const worktree = path.resolve("/tmp/hub-wt");

const repoRoot = (dir: string): string | undefined => {
  const d = normalize(dir);
  if (d.startsWith(normalize(repo)) || d.startsWith(normalize(worktree))) return normalize(repo);
  if (d.startsWith(normalize(other))) return normalize(other);
  return undefined;
};

const session = (cwd: string, worktrees?: string[]) => ({ cwd, worktrees });

describe("sessionFilter", () => {
  it("shows everything for scope all or with no folder open", () => {
    assert.equal(sessionFilter([argus], "all", repoRoot)(session(other)), true);
    assert.equal(sessionFilter([], "folder", repoRoot)(session(other)), true);
    assert.equal(sessionFilter([], "window", repoRoot)(session(other)), true);
  });

  it("window scope includes sibling folders and worktrees of the same repo", () => {
    const inWindow = sessionFilter([argus], "window", repoRoot);
    assert.equal(inWindow(session(path.join(argus, "src"))), true);
    assert.equal(inWindow(session(website)), true);
    assert.equal(inWindow(session(worktree)), true);
    assert.equal(inWindow(session(other)), false);
  });

  it("folder scope only includes sessions inside the window's folders", () => {
    const inWindow = sessionFilter([argus], "folder", repoRoot);
    assert.equal(inWindow(session(argus)), true);
    assert.equal(inWindow(session(path.join(argus, "src"))), true);
    assert.equal(inWindow(session(website)), false);
    assert.equal(inWindow(session(repo)), false);
    assert.equal(inWindow(session(worktree)), false);
    assert.equal(inWindow(session(other)), false);
  });

  it("folder scope matches a linked worktree inside the folder, and not a name-prefix sibling", () => {
    const inWindow = sessionFilter([argus], "folder", repoRoot);
    assert.equal(inWindow(session(other, [path.join(argus, ".worktrees", "x")])), true);
    assert.equal(inWindow(session(argus + "-old")), false);
  });

  it("folder scope never asks git for repo roots", () => {
    const calls: string[] = [];
    sessionFilter([argus], "folder", (dir) => (calls.push(dir), undefined))(session(website));
    assert.deepEqual(calls, []);
  });

  it("matches folders case-insensitively on Windows and macOS", { skip: process.platform === "linux" }, () => {
    assert.equal(sessionFilter([argus], "folder", repoRoot)(session(argus.toUpperCase())), true);
  });
});

describe("parseScope", () => {
  it("falls back to window for unknown values", () => {
    assert.equal(parseScope("folder"), "folder");
    assert.equal(parseScope("all"), "all");
    assert.equal(parseScope("window"), "window");
    assert.equal(parseScope("nope"), "window");
    assert.equal(parseScope(undefined), "window");
  });

  it("accepts every value package.json offers", () => {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const values: string[] = pkg.contributes.configuration.properties?.["argus.sessions.scope"]?.enum
      ?? [pkg.contributes.configuration].flat().map((c: any) => c.properties?.["argus.sessions.scope"]?.enum).find(Boolean);
    assert.deepEqual([...values].sort(), ["all", "folder", "window"]);
    for (const value of values) assert.equal(parseScope(value), value);
  });
});
