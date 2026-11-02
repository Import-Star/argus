import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeCron, parseScheduledTasks } from "../src/chat/loops.ts";

const FILE = JSON.stringify({
  tasks: [
    { id: "a1", cron: "*/5 * * * *", prompt: "check the build", recurring: true, createdAt: 1 },
    { id: "b2", cron: "30 14 28 2 *", prompt: "remind me", recurring: false },
    { id: "", cron: "* * * * *", prompt: "no id" },
    null
  ]
});

describe("scheduled tasks file", () => {
  it("lists well-formed tasks and skips the rest", () => {
    assert.deepEqual(parseScheduledTasks(FILE), [
      { id: "a1", schedule: "*/5 * * * *", recurring: true, prompt: "check the build" },
      { id: "b2", schedule: "30 14 28 2 *", recurring: false, prompt: "remind me" }
    ]);
    assert.deepEqual(parseScheduledTasks("not json"), []);
  });
});

describe("describeCron", () => {
  it("words the simple shapes and leaves the rest raw", () => {
    assert.equal(describeCron("*/5 * * * *"), "Every 5 minutes");
    assert.equal(describeCron("0 9 * * 1-5"), "Weekdays at 09:00");
    assert.equal(describeCron("15 * * * *"), "Every hour at :15");
    assert.equal(describeCron("30 14 28 2 *"), "30 14 28 2 *");
  });
});
