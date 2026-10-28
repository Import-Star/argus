import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hunkRange, withGaps } from "../chat/host/diffGaps.ts";

// New side of a 20-line file where lines 11 and 12 were added after old line 10.
const content = Array.from({ length: 20 }, (_, at) => `line ${at + 1}`);
const hunk = {
  header: "@@ -9,3 +9,5 @@",
  lines: [
    { type: "ctx" as const, old: 9, new: 9, text: "line 9" },
    { type: "ctx" as const, old: 10, new: 10, text: "line 10" },
    { type: "add" as const, new: 11, text: "line 11" },
    { type: "add" as const, new: 12, text: "line 12" },
    { type: "ctx" as const, old: 11, new: 13, text: "line 13" }
  ]
};

describe("hunkRange", () => {
  it("gives the offset before and after the hunk", () => {
    assert.deepEqual(hunkRange("@@ -9,3 +9,5 @@"), { start: 9, end: 13, offset: 0, after: -2 });
  });
  it("handles pure insertions and deletions", () => {
    assert.deepEqual(hunkRange("@@ -5,0 +6,2 @@"), { start: 6, end: 7, offset: 0, after: -2 });
    assert.deepEqual(hunkRange("@@ -5,2 +4,0 @@"), { start: 5, end: 4, offset: 0, after: 2 });
  });
});

describe("withGaps", () => {
  it("numbers old lines after the last hunk with the offset after it", () => {
    const lines = withGaps([hunk], content);
    const tail = lines.at(-1)?.lines ?? [];
    assert.deepEqual(tail[0], { oldNo: 12, newNo: 14, text: "line 14" });
    assert.deepEqual(tail.at(-1), { oldNo: 18, newNo: 20, text: "line 20" });
  });
  it("numbers the gap before the first hunk one to one", () => {
    const head = withGaps([hunk], content)[0].lines ?? [];
    assert.deepEqual(head.map((line) => [line.oldNo, line.newNo]), [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, n]));
  });
});
