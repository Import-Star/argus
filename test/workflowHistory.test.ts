import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { withWorkflowTasks } from "../chat/host/workflowHistory.ts";
import { backgroundTasks } from "../chat/webview/backgroundTasks.ts";
import { taskGraph } from "../chat/webview/workflow.ts";

function runDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-wf-"));
  const journal = [
    { type: "launched" },
    { type: "started", agentId: "a1", label: "build:web", phase: "Build" },
    { type: "started", agentId: "a2", label: "build:api", phase: "Build" },
    { type: "started", agentId: "a3", label: "verify", phase: "Verify" },
    { type: "result", agentId: "a1", result: "ok" },
    { type: "result", agentId: "a2", result: "ok" }
  ];
  fs.writeFileSync(path.join(dir, "journal.jsonl"), journal.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  return dir;
}

function transcript(dir: string, notified: boolean) {
  const messages = [
    { type: "assistant", uuid: "m1", session_id: "s", message: { content: [{ type: "tool_use", id: "toolu_1", name: "Workflow", input: { script: "export const meta = { name: 'acme-build' }" } }] } },
    { type: "user", uuid: "m2", session_id: "s", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: `Workflow launched in background. Task ID: wabc\nSummary: Build acme\nTranscript dir: ${dir}\n` }] } }
  ];
  const note = { type: "user", uuid: "m3", session_id: "s", message: { role: "user", content: "<task-notification>\n<task-id>wabc</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<status>completed</status>\n<summary>Workflow done</summary>\n</task-notification>" } };
  return withWorkflowTasks(notified ? [...messages, note] : messages) as never[];
}

describe("workflow rebuilt from a saved transcript", () => {
  it("lists a running workflow with its agents by phase", () => {
    const messages = transcript(runDir(), false);
    assert.deepEqual(backgroundTasks(messages).map((task) => [task.id, task.label, task.state]), [["wabc", "workflow", "running"]]);
    const workflow = taskGraph(messages).workflows[0];
    assert.equal(workflow.taskId, "wabc");
    assert.equal(workflow.status, "running");
    assert.deepEqual(workflow.columns.map((column) => [column.title, column.agents.map((agent) => `${agent.description}:${agent.status}`)]), [
      ["Build", ["build:web:done", "build:api:done"]],
      ["Verify", ["verify:waiting"]]
    ]);
  });

  it("marks the workflow done from its task notification", () => {
    const messages = transcript(runDir(), true);
    assert.equal(backgroundTasks(messages)[0].state, "done");
    const workflow = taskGraph(messages).workflows[0];
    assert.equal(workflow.status, "done");
    assert.equal(workflow.summary, "Workflow done");
  });
});
