import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findingsFromText, scenarioParts } from "../chat/webview/findings.ts";

describe("scenarioParts", () => {
  it("splits repro, likelihood and fix", () => {
    const parts = scenarioParts("Reproduced: `node probe.ts` → true. Likelihood: medium (next copy-paste). Fix: reject at boot.");
    assert.deepEqual(parts, [
      { label: "Reproduced", text: "`node probe.ts` → true." },
      { label: "Likelihood", text: "medium (next copy-paste)." },
      { label: "Fix", text: "reject at boot." }
    ]);
  });

  it("labels no-repro and unprefixed text", () => {
    assert.deepEqual(scenarioParts("No repro needed. Two copies can drift. Fix: import it."), [
      { label: "No repro", text: "Two copies can drift." },
      { label: "Fix", text: "import it." }
    ]);
    assert.deepEqual(scenarioParts("Balance doubles on retry"), [{ label: "Scenario", text: "Balance doubles on retry" }]);
  });

  it("does not split on words ending in fix", () => {
    assert.equal(scenarioParts("Not reproduced: the Prefix: header is unset").length, 1);
  });

  it("returns nothing for empty text", () => {
    assert.deepEqual(scenarioParts(""), []);
  });
});

describe("findingsFromText", () => {
  const text = [
    "Checked the cart service.",
    "",
    "2 findings, most severe first:",
    "",
    "1. `src/cart.ts:42`: Total skips the discount",
    "   when the coupon is empty.",
    "",
    "   Failure scenario: Empty coupon → full price charged.",
    "",
    "2. `README.md`: Install step is out of date.",
    "",
    "   Failure scenario: New users run the wrong command."
  ].join("\n");

  it("turns the CLI's findings text into a findings card after its preamble", () => {
    const [intro, card] = findingsFromText(text, "x") ?? [];
    assert.deepEqual(intro, { kind: "note", id: "x:intro", text: "Checked the cart service.", tone: "muted", reply: true });
    assert.equal(card.kind, "findings");
    assert.deepEqual(card.kind === "findings" && card.findings.map((finding) => [finding.file, finding.line, finding.summary, finding.failureScenario]), [
      ["src/cart.ts", 42, "Total skips the discount\n   when the coupon is empty.", "Empty coupon → full price charged."],
      ["README.md", undefined, "Install step is out of date.", "New users run the wrong command."]
    ]);
  });

  it("leaves the text alone when it doesn't parse cleanly", () => {
    assert.equal(findingsFromText("Nothing to report.", "x"), undefined);
    assert.equal(findingsFromText(text.replace("2 findings", "3 findings"), "x"), undefined);
    assert.equal(findingsFromText(text.replace("   Failure scenario: New users", "   Impact: New users"), "x"), undefined);
  });
});
