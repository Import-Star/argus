import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { quoteLine } from "../chat/webview/review.ts";

describe("quoteLine", () => {
  const source = ["# Title", "", "| Fn | Args |", "| --- | --- |", "| add | a, b |", "| subtract | a, b |", "", "- Both reject `NaN`", "- Both are **pure** and [linked](https://example.com)"];

  it("finds the source line of rendered text", () => {
    assert.equal(quoteLine(source, 3, 6, "subtract\ta, b"), 6);
    assert.equal(quoteLine(source, 8, 9, "Both are pure and linked"), 9);
    assert.equal(quoteLine(source, 8, 9, "reject NaN\nBoth are pure"), 8);
  });

  it("falls back to the block's first line", () => {
    assert.equal(quoteLine(source, 3, 6, "not in the table"), 3);
  });
});
