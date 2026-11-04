import type { Token } from "marked";

export interface BlockLines {
  token: Token;
  start: number;
  end: number;
}

// Source line range of each top-level block, from the lexer's raw text.
export function blockLines(tokens: Token[]): BlockLines[] {
  const blocks: BlockLines[] = [];
  let line = 1;
  for (const token of tokens) {
    const breaks = token.raw.split("\n").length - 1;
    if (token.type !== "space") {
      blocks.push({ token, start: line, end: Math.max(line, line + breaks - (token.raw.endsWith("\n") ? 1 : 0)) });
    }
    line += breaks;
  }
  return blocks;
}
