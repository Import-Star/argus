import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { callbackUrlProblem, countMcpIssues, toMcpServers } from "../src/chat/panels/mcp.ts";

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

  it("offers Authenticate for needs-auth and for failed remote servers, whose stored token may be the problem", () => {
    const servers = toMcpServers([
      { name: "http", status: "failed", error: "The token hook target responded with an error.", config: { type: "http", url: "https://mcp.example.com" } },
      { name: "sse", status: "failed", config: { type: "sse", url: "https://mcp.example.com" } },
      { name: "stdio", status: "failed", config: { type: "stdio", command: "node" } },
      { name: "claudeai", status: "failed", config: { type: "claudeai-proxy", url: "https://mcp.example.com", id: "x" } },
      { name: "auth", status: "needs-auth" },
      { name: "ok", status: "connected", config: { type: "http", url: "https://mcp.example.com" } }
    ]);
    assert.deepEqual(
      Object.fromEntries(servers.map((server) => [server.name, server.canAuthenticate])),
      { auth: true, claudeai: true, http: true, ok: false, sse: true, stdio: false }
    );
  });

  it("counts failed and needs-auth as issues", () => {
    assert.equal(countMcpIssues([{ status: "failed" }, { status: "needs-auth" }, { status: "pending" }, { status: "disabled" }, { status: "connected" }]), 2);
  });
});

describe("callbackUrlProblem", () => {
  it("accepts a redirect carrying a code or an error, and rejects anything else", () => {
    assert.equal(callbackUrlProblem(" http://localhost:4567/callback?code=abc&state=xyz "), undefined);
    assert.equal(callbackUrlProblem("http://localhost:4567/callback?error=access_denied"), undefined);
    assert.ok(callbackUrlProblem("http://localhost:4567/callback?state=xyz"));
    assert.ok(callbackUrlProblem("not a url"));
  });
});
