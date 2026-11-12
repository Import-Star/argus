import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inlineMarkdown, parseChangelog, versionToAnnounce } from "../src/services/releaseNotes.ts";

describe("parseChangelog", () => {
  it("splits highlights from changes, joins wrapped lines and skips Unreleased", () => {
    const releases = parseChangelog(`# Changelog

## Unreleased

- not shipped yet

## 1.2.0

### Highlights

- **Big thing.** It does a lot.

### Changes

- A fix that wraps
  onto a second line.

## 1.1.0

- Old change.
`);
    assert.deepEqual(releases, [
      { version: "1.2.0", highlights: ["**Big thing.** It does a lot."], changes: ["A fix that wraps onto a second line."] },
      { version: "1.1.0", highlights: [], changes: ["Old change."] }
    ]);
  });
});

describe("inlineMarkdown", () => {
  it("renders code, bold and https links, and escapes the rest", () => {
    assert.equal(
      inlineMarkdown("**Type `#<b>`** see [docs](https://example.com/a) <i>"),
      '<b>Type <code>#&lt;b&gt;</code></b> see <a href="#" data-url="https://example.com/a">docs</a> &lt;i&gt;'
    );
  });
});

describe("versionToAnnounce", () => {
  it("shows after an update, not on a first install or a reload", () => {
    assert.equal(versionToAnnounce("1.2.0", "1.1.0", true), "1.2.0");
    assert.equal(versionToAnnounce("1.2.0", undefined, true), "1.2.0");
    assert.equal(versionToAnnounce("1.2.0", undefined, false), undefined);
    assert.equal(versionToAnnounce("1.2.0", "1.2.0", true), undefined);
  });
});
