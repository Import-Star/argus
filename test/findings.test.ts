import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scenarioParts, severityOf } from "../chat/webview/findings.ts";

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

describe("severityOf", () => {
  it("maps known categories and ignores unknown ones", () => {
    assert.equal(severityOf("correctness"), "high");
    assert.equal(severityOf("Hardening"), "medium");
    assert.equal(severityOf("docs"), "low");
    assert.equal(severityOf("something-new"), undefined);
    assert.equal(severityOf(undefined), undefined);
  });
});
