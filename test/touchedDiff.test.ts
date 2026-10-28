import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { loadTouchedDiff } from "../src/diffReview/git.ts";

function repo(dir: string, files: Record<string, string>): void {
  fs.mkdirSync(dir, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdio: "ignore" });
  git("init", "-q", "-b", "main");
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  git("add", ".");
  git("commit", "-q", "-m", "init");
}

describe("loadTouchedDiff", () => {
  it("diffs files in a repo nested in the session's folder, in that repo", async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "argus-touched-"));
    try {
      repo(parent, { "a.txt": "one\n", "other.txt": "x\n" });
      const nested = path.join(parent, "apps", "inner");
      repo(nested, { "src/b.txt": "two\n" });
      fs.writeFileSync(path.join(parent, "a.txt"), "one!\n");
      fs.writeFileSync(path.join(parent, "other.txt"), "changed but not by the session\n");
      fs.writeFileSync(path.join(nested, "src", "b.txt"), "two!\n");
      fs.writeFileSync(path.join(nested, "src", "new.txt"), "new\n");

      const touched = [path.join(parent, "a.txt"), path.join(nested, "src", "b.txt"), "apps/inner/src/new.txt"];
      const { base, files } = await loadTouchedDiff(parent, touched, "main", 3);

      assert.equal(base, "main");
      assert.deepEqual(
        files.map((file) => [file.path, file.rel, path.relative(parent, file.root).split(path.sep).join("/")]),
        [
          ["a.txt", "a.txt", ""],
          ["apps/inner/src/b.txt", "src/b.txt", "apps/inner"],
          ["apps/inner/src/new.txt", "src/new.txt", "apps/inner"]
        ]
      );
      assert.deepEqual(
        files.map((file) => [file.additions, file.deletions]),
        [
          [1, 1],
          [1, 1],
          [1, 0]
        ]
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it("leaves out files that aren't in a repo or have no changes", async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "argus-touched-"));
    const loose = fs.mkdtempSync(path.join(os.tmpdir(), "argus-loose-"));
    try {
      repo(parent, { "a.txt": "one\n" });
      fs.writeFileSync(path.join(loose, "c.txt"), "c\n");
      const { files } = await loadTouchedDiff(parent, [path.join(parent, "a.txt"), path.join(loose, "c.txt"), path.join(parent, "gone", "d.txt")], "main", 3);
      assert.deepEqual(files, []);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
      fs.rmSync(loose, { recursive: true, force: true });
    }
  });
});
