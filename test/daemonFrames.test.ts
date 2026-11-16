import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeFrame, frameReader } from "../src/chat/daemonProtocol.ts";

describe("frameReader", () => {
  it("joins a frame split across chunks (even inside a character) and splits frames sharing a chunk", () => {
    const seen: unknown[] = [];
    const read = frameReader((frame) => seen.push(frame));
    const bytes = Buffer.from(encodeFrame({ id: 1, ok: true, result: "é" }) + encodeFrame({ id: 2, ok: true }));
    read(bytes.subarray(0, 29));
    read(bytes.subarray(29));
    assert.deepEqual(seen, [{ id: 1, ok: true, result: "é" }, { id: 2, ok: true }]);
  });
});
