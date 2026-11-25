import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { descendants, parseProcessTable } from "../src/chat/processTree.ts";

describe("parseProcessTable", () => {
  it("reads ps and Windows listings, skipping anything else", () => {
    assert.deepEqual(parseProcessTable("  1     0\n 42  1\r\n\nPID PPID\n7 42\n"), [
      { pid: 1, ppid: 0 },
      { pid: 42, ppid: 1 },
      { pid: 7, ppid: 42 }
    ]);
  });
});

describe("descendants", () => {
  it("finds the whole tree below root, parents first", () => {
    const table = [
      { pid: 10, ppid: 1 },
      { pid: 20, ppid: 10 },
      { pid: 21, ppid: 10 },
      { pid: 30, ppid: 20 },
      { pid: 99, ppid: 1 }
    ];
    assert.deepEqual(descendants(table, 10), [20, 21, 30]);
  });

  it("stops on a parent loop left by reused process ids", () => {
    assert.deepEqual(descendants([{ pid: 2, ppid: 3 }, { pid: 3, ppid: 2 }, { pid: 0, ppid: 0 }], 2), [3]);
  });
});
