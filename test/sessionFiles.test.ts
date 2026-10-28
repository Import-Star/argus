import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SDKMessage } from "../src/chat/protocol.ts";
import { relativeTo, sessionFiles, uriToPath } from "../chat/webview/sessionFiles.ts";

function edits(...files: string[]): SDKMessage[] {
  return [
    {
      type: "assistant",
      message: { content: files.map((file_path, at) => ({ type: "tool_use", id: `t${at}`, name: "Edit", input: { file_path } })) }
    } as unknown as SDKMessage
  ];
}

describe("sessionFiles", () => {
  it("makes POSIX paths under cwd relative and drops the rest", () => {
    assert.deepEqual(sessionFiles(edits("/proj/src/a.ts", "/other/b.ts", "src/c.ts"), "/proj"), ["src/a.ts", "src/c.ts"]);
  });
  it("makes Windows paths under cwd relative, ignoring case, and drops the rest", () => {
    const files = edits("C:\\Users\\me\\proj\\src\\a.ts", "c:\\users\\me\\proj\\b.ts", "D:\\elsewhere\\c.ts", "src\\d.ts");
    assert.deepEqual(sessionFiles(files, "C:\\Users\\me\\proj"), ["src/a.ts", "b.ts", "src/d.ts"]);
  });
  it("drops absolute paths when there is no cwd", () => {
    assert.deepEqual(sessionFiles(edits("C:\\proj\\a.ts", "/proj/b.ts", "c.ts")), ["c.ts"]);
  });
});

describe("relativeTo", () => {
  it("needs a separator after cwd", () => {
    assert.equal(relativeTo("/proj-two/a.ts", "/proj"), undefined);
    assert.equal(relativeTo("C:\\proj\\", "C:\\proj"), undefined);
  });
  it("keeps case on POSIX", () => {
    assert.equal(relativeTo("/Proj/a.ts", "/proj"), undefined);
  });
});

describe("uriToPath", () => {
  it("makes a dropped file relative to cwd", () => {
    assert.equal(uriToPath("file:///home/me/proj/src/a.ts", "/home/me/proj"), "src/a.ts");
    assert.equal(uriToPath("file:///c%3A/Users/me/proj/src/a.ts", "C:\\Users\\me\\proj"), "src/a.ts");
  });
  it("keeps files outside cwd absolute, in the platform's form", () => {
    assert.equal(uriToPath("file:///c%3A/Other/a%20b.ts", "C:\\Users\\me\\proj"), "c:\\Other\\a b.ts");
    assert.equal(uriToPath("file://server/share/a.ts", "C:\\proj"), "\\\\server\\share\\a.ts");
    assert.equal(uriToPath("file:///tmp/a.ts", "/home/me/proj"), "/tmp/a.ts");
  });
  it("ignores other URIs", () => {
    assert.equal(uriToPath("https://example.com/a.ts", "/proj"), undefined);
  });
});
