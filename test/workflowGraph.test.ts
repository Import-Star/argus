import assert from "node:assert/strict";
import * as fs from "node:fs";
import { describe, it } from "node:test";
import { agentCounts, taskGraph } from "../chat/webview/workflow.ts";

const captured = fs
  .readFileSync(new URL("./fixtures/workflow-messages.jsonl", import.meta.url), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

function graphAt(count: number) {
  return taskGraph(captured.slice(0, count)).workflows[0];
}

describe("workflow graph from workflow_progress", () => {
  it("shows a queued and a running agent in their phase mid-way", () => {
    const workflow = graphAt(3);
    assert.equal(workflow.status, "running");
    assert.deepEqual(workflow.columns.map((column) => [column.title, column.agents.length]), [["Ping", 2]]);
    assert.deepEqual(workflow.agents.map((agent) => agent.status), ["running", "waiting"]);
  });

  it("keeps the last snapshot when a progress message omits it, and shows one done", () => {
    const workflow = graphAt(6);
    assert.deepEqual(workflow.agents.map((agent) => agent.status), ["done", "running"]);
    assert.equal(workflow.agents[0].resultPreview, "pong");
    assert.equal(workflow.agents[0].tokens, 33154);
  });

  it("finishes done with both agents done", () => {
    const workflow = graphAt(captured.length);
    assert.equal(workflow.status, "done");
    assert.equal(workflow.agents.length, 2);
    assert.equal(agentCounts(workflow.agents).done, 2);
    assert.equal(workflow.agents[1].agentId, "ad780462d6c066276");
  });

  it("stops agents still running when the workflow is killed", () => {
    const killed = [...captured.slice(0, 3), { ...captured[8], patch: { status: "killed" } }];
    assert.deepEqual(taskGraph(killed).workflows[0].agents.map((agent) => agent.status), ["stopped", "stopped"]);
  });
});
