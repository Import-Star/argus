import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inlineMarkdown, notesFor, parseChangelog, versionToAnnounce } from "../src/services/releaseNotes.ts";

describe("parseChangelog", () => {
  it("splits highlights from changes, joins wrapped lines and skips Unreleased", () => {
    const releases = parseChangelog(`# Changelog

## Unreleased

- not shipped yet

## 1.2.0

### Highlights

- **Big thing.** It does a lot.

  ![The big thing](media/whats-new/1.2.0-big.png)
- **Small thing.** Wraps
  onto a second line.

### Changes

- A fix that wraps
  onto a second line.

## 1.1.0

- Old change.
`);
    assert.deepEqual(releases, [
      {
        version: "1.2.0",
        highlights: [
          { text: "**Big thing.** It does a lot.", image: { alt: "The big thing", path: "media/whats-new/1.2.0-big.png" } },
          { text: "**Small thing.** Wraps onto a second line." }
        ],
        changes: [{ text: "A fix that wraps onto a second line." }]
      },
      { version: "1.1.0", highlights: [], changes: [{ text: "Old change." }] }
    ]);
  });

  it("reads a picture whose link vsce rewrote to a GitHub URL as the bundled file", () => {
    const [release] = parseChangelog(`## 1.2.0

### Highlights

- **Big thing.**

  ![The big thing](https://github.com/Import-Star/argus/raw/HEAD/media/whats-new/1.2.0-big.png)
`);
    assert.deepEqual(release.highlights, [{ text: "**Big thing.**", image: { alt: "The big thing", path: "media/whats-new/1.2.0-big.png" } }]);
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

describe("notesFor", () => {
  it("folds earlier patch releases into the current one", () => {
    const releases = parseChangelog(`## 1.2.1

- Patch fix.

## 1.2.0

### Highlights

- **Big thing.**

### Changes

- Minor fix.

## 1.1.0

- Old change.
`);
    assert.deepEqual(notesFor(releases, "1.2.1"), {
      current: { version: "1.2.1", highlights: [{ text: "**Big thing.**" }], changes: [{ text: "Patch fix." }, { text: "Minor fix." }] },
      missed: [],
      earlier: [releases[2]]
    });
    assert.deepEqual(notesFor(releases, "1.2.0").current?.changes, [{ text: "Minor fix." }]);
  });
  it("after an update, shows every release since the version it came from", () => {
    const releases = parseChangelog(["3.0.1", "3.0.0", "2.10.0", "2.9.1", "2.9.0", "2.8.0"].map((version) => `## ${version}\n\n- In ${version}.\n`).join("\n"));
    const notes = notesFor(releases, "3.0.1", "2.9.0");
    assert.equal(notes.current?.version, "3.0.1");
    assert.deepEqual(notes.missed.map((release) => release.version), ["3.0.1", "3.0.0", "2.10.0", "2.9.1"]);
    assert.deepEqual(notes.earlier.map((release) => release.version), ["2.9.0", "2.8.0"]);
    // An update within one minor version keeps the folded view.
    assert.deepEqual(notesFor(releases, "3.0.1", "3.0.0").missed, []);
  });
});
