import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { marked } from "marked";
import { blockLines } from "../chat/webview/markdownBlocks.ts";

describe("blockLines", () => {
  it("maps each block to its source lines", () => {
    const text = ["# Title", "", "Para one", "still para", "", "", "- a", "- b", "", "| x |", "| - |", "| 1 |", "", "```ts", "code", "```", "Tail"].join("\n");
    const blocks = blockLines(marked.lexer(text)).map(({ token, start, end }) => [token.type, start, end]);
    assert.deepEqual(blocks, [
      ["heading", 1, 1],
      ["paragraph", 3, 4],
      ["list", 7, 8],
      ["table", 10, 12],
      ["code", 14, 16],
      ["paragraph", 17, 17]
    ]);
  });
});
