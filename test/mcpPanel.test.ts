import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countMcpIssues, toMcpServers } from "../src/chat/panels/mcp.ts";

describe("toMcpServers", () => {
  it("lists problems first, then by name, and maps tool annotations", () => {
    const servers = toMcpServers([
      { name: "b", status: "connected", serverInfo: { name: "b", version: "1.2" }, tools: [{ name: "t", annotations: { readOnly: true } }] },
      { name: "a", status: "disabled" },
      { name: "c", status: "needs-auth", source: "claudeai" },
      { name: "d", status: "failed", error: "boom", scope: "user" }
    ]);
    assert.deepEqual(servers.map((server) => server.name), ["d", "c", "b", "a"]);
    assert.equal(servers[1].scope, "claudeai");
    assert.deepEqual(servers[2].tools, [{ name: "t", description: undefined, readOnly: true, destructive: undefined }]);
    assert.equal(servers[2].version, "1.2");
  });

  it("counts failed and needs-auth as issues", () => {
    assert.equal(countMcpIssues([{ status: "failed" }, { status: "needs-auth" }, { status: "pending" }, { status: "disabled" }, { status: "connected" }]), 2);
  });
});
