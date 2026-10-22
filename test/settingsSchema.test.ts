import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSettingGroups, type SettingValues } from "../src/services/settingsSchema.ts";

const properties = {
  "argus.sessions.scope": { type: "string", enum: ["window", "all"], enumDescriptions: ["a", "b"], default: "window", description: "Scope." },
  "argus.notifications": { type: "string", enum: ["all", "off"], default: "all" },
  "argus.sessions.prRefreshMinutes": { type: "number", default: 1 },
  "argus.usage.refreshMinutes": { type: "number", minimum: 1, maximum: 60, default: 5 },
  "argus.usage.enabled": { type: "boolean", default: true, description: "plain", markdownDescription: "with `code`" },
  "argus.chat.claudePath": { type: "string", default: "" },
  "argus.chat.enabled": { type: "boolean", default: false },
  "argus.diffReview.contextLines": { type: "integer", default: 3 },
  "argus.plugins.paths": { type: "array", default: [] },
  "argus.plugins.config": { type: "object", default: {} },
  "argus.prs.cacheSeconds": { type: "number", default: 300 }
};

const none = (): SettingValues | undefined => undefined;

describe("buildSettingGroups", () => {
  it("groups by the second id segment, chat first and the rest in package.json order", () => {
    const groups = buildSettingGroups({ properties }, none);
    assert.deepEqual(groups.map((group) => group.key), ["chat", "sessions", "notifications", "usage", "diffReview", "plugins", "prs"]);
    assert.deepEqual(groups.find((group) => group.key === "chat")?.fields.map((field) => field.id), ["argus.chat.claudePath", "argus.chat.enabled"]);
  });

  it("reads both the object and the array form", () => {
    const array = buildSettingGroups([{ properties: { "argus.usage.enabled": properties["argus.usage.enabled"] } }, { properties: { "argus.chat.enabled": properties["argus.chat.enabled"] } }], none);
    assert.deepEqual(array.map((group) => group.key), ["chat", "usage"]);
    assert.deepEqual(buildSettingGroups(undefined, none), []);
  });

  it("humanises titles", () => {
    const groups = buildSettingGroups({ properties }, none);
    assert.equal(groups.find((group) => group.key === "diffReview")?.title, "Diff review");
    assert.equal(groups.find((group) => group.key === "prs")?.title, "Pull requests");
    assert.equal(groups.find((group) => group.key === "diffReview")?.fields[0].title, "Context lines");
    assert.equal(groups.find((group) => group.key === "sessions")?.fields.find((field) => field.id.endsWith("prRefreshMinutes"))?.title, "PR refresh minutes");
    assert.equal(groups.find((group) => group.key === "notifications")?.fields[0].title, "Notifications");
  });

  it("maps types", () => {
    const kinds = Object.fromEntries(buildSettingGroups({ properties }, none).flatMap((group) => group.fields).map((field) => [field.id, field.kind]));
    assert.equal(kinds["argus.sessions.scope"], "enum");
    assert.equal(kinds["argus.chat.enabled"], "boolean");
    assert.equal(kinds["argus.chat.claudePath"], "string");
    assert.equal(kinds["argus.usage.refreshMinutes"], "number");
    assert.equal(kinds["argus.diffReview.contextLines"], "number");
    assert.equal(kinds["argus.plugins.paths"], "other");
    assert.equal(kinds["argus.plugins.config"], "other");
  });

  it("carries description, enum, limits and default", () => {
    const fields = buildSettingGroups({ properties }, none).flatMap((group) => group.fields);
    const scope = fields.find((field) => field.id === "argus.sessions.scope");
    assert.deepEqual([scope?.enum, scope?.enumDescriptions, scope?.description, scope?.default], [["window", "all"], ["a", "b"], "Scope.", "window"]);
    const refresh = fields.find((field) => field.id === "argus.usage.refreshMinutes");
    assert.deepEqual([refresh?.minimum, refresh?.maximum], [1, 60]);
    assert.equal(fields.find((field) => field.id === "argus.usage.enabled")?.description, "with `code`");
  });

  it("resolves the effective value and which scopes set it", () => {
    const inspect = (id: string): SettingValues | undefined =>
      id === "argus.chat.enabled" ? { defaultValue: false, globalValue: true, workspaceValue: false } : id === "argus.usage.enabled" ? { defaultValue: true } : undefined;
    const fields = buildSettingGroups({ properties }, inspect).flatMap((group) => group.fields);
    const chat = fields.find((field) => field.id === "argus.chat.enabled");
    assert.deepEqual([chat?.value, chat?.userSet, chat?.workspaceSet], [false, true, true]);
    const usage = fields.find((field) => field.id === "argus.usage.enabled");
    assert.deepEqual([usage?.value, usage?.userSet, usage?.workspaceSet], [true, false, false]);
    const missing = fields.find((field) => field.id === "argus.prs.cacheSeconds");
    assert.deepEqual([missing?.value, missing?.userSet], [300, false]);
  });
});
