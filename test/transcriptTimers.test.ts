import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { TranscriptIndex } from "../src/services/TranscriptIndex.ts";

const T0 = Date.parse("2026-10-20T00:00:00Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

function use(id: string, name: string, input: Record<string, unknown>, minutes = 0) {
  return { type: "assistant", timestamp: at(minutes), message: { id: `m-${id}`, content: [{ type: "tool_use", id, name, input }] } };
}

function result(id: string, toolUseResult: Record<string, unknown>, minutes = 0) {
  return { type: "user", timestamp: at(minutes), message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] }, toolUseResult };
}

function notice(taskId: string, status?: string, minutes = 1) {
  const tail = status ? `<status>${status}</status>\n<summary>done</summary>` : "<summary>Monitor event: line</summary>";
  return { type: "queue-operation", operation: "enqueue", timestamp: at(minutes), content: `<task-notification>\n<task-id>${taskId}</task-id>\n${tail}\n</task-notification>` };
}

async function timers(lines: object[], processStart = 0, now = T0 + 5 * 60_000) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-timers-"));
  const transcriptPath = path.join(dir, "s1.jsonl");
  fs.writeFileSync(transcriptPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  const index = new TranscriptIndex();
  await index.update([{ sessionId: "s1", transcriptPath }]);
  return index.timers(transcriptPath, processStart, now);
}

describe("TranscriptIndex.timers", () => {
  it("shows a pending wakeup with its time and reason", async () => {
    const found = await timers([use("w", "ScheduleWakeup", { delaySeconds: 600, reason: "check deploy" }), result("w", { scheduledFor: T0 + 600_000 })]);
    assert.deepEqual(found, [{ kind: "wakeup", label: "check deploy", since: T0, at: T0 + 600_000 }]);
  });

  it("drops a wakeup once its time passes, or when the loop is stopped", async () => {
    const passed = await timers([use("w", "ScheduleWakeup", { reason: "r" }), result("w", { scheduledFor: T0 + 60_000 })]);
    assert.deepEqual(passed, []);
    const stopped = await timers([
      use("w", "ScheduleWakeup", { reason: "r" }),
      result("w", { scheduledFor: T0 + 600_000 }),
      use("s", "ScheduleWakeup", { stop: true }),
      result("s", { scheduledFor: 0, stopped: true })
    ]);
    assert.deepEqual(stopped, []);
  });

  it("tracks background commands, monitors and agents until their finish notice", async () => {
    const found = await timers([
      use("b", "Bash", { command: "sleep 99", description: "wait", run_in_background: true }),
      result("b", { backgroundTaskId: "task1" }),
      use("m", "Monitor", { description: "deploy watch" }),
      result("m", { taskId: "task2" }),
      use("a", "Agent", { description: "tests" }),
      result("a", { isAsync: true, agentId: "agent1", description: "tests" }),
      notice("task1", "completed"),
      notice("task2")
    ]);
    assert.deepEqual(
      found.map((timer) => [timer.kind, timer.label]),
      [
        ["monitor", "deploy watch"],
        ["agent", "tests"]
      ]
    );
  });

  it("ends an agent on its hand-back message and a task on TaskStop", async () => {
    const found = await timers([
      use("a", "Agent", { description: "tests" }),
      result("a", { isAsync: true, agentId: "agent1", description: "tests" }),
      use("b", "Bash", { command: "x", run_in_background: true }),
      result("b", { backgroundTaskId: "task1" }),
      { type: "queue-operation", operation: "enqueue", timestamp: at(2), content: '<agent-message from="agent1">report</agent-message>' },
      use("k", "TaskStop", { task_id: "task1" }, 2)
    ]);
    assert.deepEqual(found, []);
  });

  it("ignores foreground Bash and failed calls", async () => {
    const found = await timers([
      use("b", "Bash", { command: "ls" }),
      result("b", { stdout: "" }),
      use("w", "ScheduleWakeup", { reason: "r" }),
      { type: "user", timestamp: at(0), message: { content: [{ type: "tool_result", tool_use_id: "w", is_error: true }] }, toolUseResult: { scheduledFor: T0 + 600_000 } }
    ]);
    assert.deepEqual(found, []);
  });

  it("keeps a recurring cron after its first run until deleted or 7 days old", async () => {
    const lines = [use("c", "CronCreate", { cron: "7,37 * * * *", recurring: true, prompt: "spot check" }), result("c", { id: "cron1", recurring: true, humanSchedule: "7,37 * * * *", nextFireAt: T0 + 60_000 })];
    assert.deepEqual((await timers(lines)).map((timer) => timer.schedule), ["7,37 * * * *"]);
    assert.deepEqual(await timers(lines, 0, T0 + 8 * 86_400_000), []);
    assert.deepEqual(await timers([...lines, use("d", "CronDelete", { id: "cron1" }, 3)]), []);
  });

  it("hides timers set before the Claude process started", async () => {
    const found = await timers([use("w", "ScheduleWakeup", { reason: "r" }), result("w", { scheduledFor: T0 + 600_000 })], T0 + 1);
    assert.deepEqual(found, []);
  });
});
