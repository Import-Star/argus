import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BranchCache } from "../chat/host/branchCache.ts";

describe("BranchCache", () => {
  it("looks each folder up once until the entry expires", () => {
    let now = 0;
    const lookups: string[] = [];
    const cache = new BranchCache((folder) => (lookups.push(folder), folder === "/a" ? "main" : undefined), 10_000, () => now);
    assert.equal(cache.get("/a"), "main");
    assert.equal(cache.get("/a"), "main");
    assert.equal(cache.get("/b"), undefined);
    assert.equal(cache.get("/b"), undefined);
    assert.deepEqual(lookups, ["/a", "/b"]);
    now = 10_000;
    cache.get("/a");
    assert.deepEqual(lookups, ["/a", "/b", "/a"]);
  });
});
