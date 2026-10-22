import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionColumn } from "../src/types.ts";
import { addToGroup, groupCards, groupColumn, groupSummary, membersOf, pruneGroups } from "../src/services/sessionGroups.ts";

function card(sessionId: string, column: SessionColumn, startedAt = 1) {
  return { record: { sessionId, startedAt }, column };
}

describe("groupColumn", () => {
  it("picks the most urgent member", () => {
    assert.equal(groupColumn(["idle", "working", "pr-open"]), "working");
    assert.equal(groupColumn(["archived", "idle", "needs-you"]), "needs-you");
    assert.equal(groupColumn(["archived", "idle"]), "idle");
    assert.equal(groupColumn(["pr-open", "idle"]), "pr-open");
    assert.equal(groupColumn(["archived", "archived"]), "archived");
  });
});

describe("groupSummary", () => {
  it("counts members by column, most urgent first", () => {
    assert.equal(groupSummary(["idle", "needs-you", "working", "idle"]), "1 needs you · 1 working · 2 idle");
  });
});

describe("addToGroup", () => {
  it("starts a group named after the first session", () => {
    assert.deepEqual(addToGroup({}, "b", "a"), { a: "a", b: "a" });
  });
  it("joins the existing session's group", () => {
    assert.deepEqual(addToGroup({ a: "a", b: "a" }, "c", "b"), { a: "a", b: "a", c: "a" });
  });
});

describe("membersOf", () => {
  it("returns the session alone when ungrouped", () => {
    assert.deepEqual(membersOf({ a: "a", b: "a" }, "z"), ["z"]);
  });
  it("puts the group's own session first", () => {
    assert.deepEqual(membersOf({ b: "a", c: "a", a: "a" }, "c"), ["a", "b", "c"]);
  });
});

describe("groupCards", () => {
  const groupOf = { a: "a", b: "a", c: "a" };
  it("groups present members under the most urgent column", () => {
    const groups = groupCards([card("c", "idle"), card("x", "idle"), card("b", "needs-you"), card("a", "working")], groupOf);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].id, "a");
    assert.deepEqual(groups[0].members.map((member) => member.record.sessionId), ["a", "b", "c"]);
    assert.equal(groups[0].column, "needs-you");
    assert.equal(groups[0].summary, "1 needs you · 1 working · 1 idle");
  });
  it("ignores a group left with one member on the board", () => {
    assert.deepEqual(groupCards([card("a", "idle"), card("x", "idle")], groupOf), []);
  });
  it("keeps a group whose first session is gone", () => {
    const groups = groupCards([card("b", "idle"), card("c", "working")], groupOf);
    assert.deepEqual(groups[0].members.map((member) => member.record.sessionId), ["b", "c"]);
    assert.equal(groups[0].column, "working");
  });
});

describe("pruneGroups", () => {
  it("drops removed sessions from their group", () => {
    assert.deepEqual(pruneGroups({ a: "a", b: "a", c: "a" }, new Set(["b"])), { a: "a", c: "a" });
  });
});
