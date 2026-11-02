import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDaemonStatus, summariseDaemonConfig } from "../src/chat/daemon.ts";

describe("parseDaemonStatus", () => {
  it("reads a stopped daemon", () => {
    assert.deepEqual(parseDaemonStatus("not running\n\nbg sessions:\n  pid: 99"), { running: false, fields: [] });
  });

  it("reads pid, version and uptime when running", () => {
    const status = parseDaemonStatus("running\n  pid:     4242\n  version: 1.2.3\n  uptime:  3h 2m\n");
    assert.deepEqual(status, { running: true, fields: [{ label: "PID", value: "4242" }, { label: "Version", value: "1.2.3" }, { label: "Uptime", value: "3h 2m" }] });
  });
});

describe("summariseDaemonConfig", () => {
  it("summarises values and leaves out secrets", () => {
    const raw = JSON.stringify({ workers: [{ name: "nightly" }, "cleanup"], port: 7000, apiToken: "x", note: "a".repeat(40), nested: { a: 1, password: "p" } });
    assert.deepEqual(summariseDaemonConfig(raw), [
      { key: "workers", value: "2: nightly, cleanup" },
      { key: "port", value: "7000" },
      { key: "nested", value: "a" }
    ]);
    assert.deepEqual(summariseDaemonConfig("nope"), []);
  });
});
