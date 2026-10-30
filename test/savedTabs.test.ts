import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tabsToSave, unrestored } from "../chat/host/savedTabs.ts";

const tab = (label: string, index: number) => ({ label, index });

describe("unrestored", () => {
  it("leaves out one tab per live panel with that label", () => {
    const tabs = [tab("New chat", 0), tab("Fix bug", 1), tab("New chat", 2)];
    assert.deepEqual(unrestored(tabs, ["New chat"]), [tab("Fix bug", 1), tab("New chat", 2)]);
  });
});

describe("tabsToSave", () => {
  it("keeps a saved tab only while an unrestored tab still has its label", () => {
    const saved = [{ sessionId: "a", title: "Fix bug" }, { sessionId: "b", title: "Closed" }];
    assert.deepEqual(tabsToSave(saved, [], ["Fix bug"]), [{ sessionId: "a", title: "Fix bug" }]);
  });
  it("prefers the live tab over the saved one for the same chat", () => {
    const saved = [{ sessionId: "a", title: "Old title" }];
    const live = [{ sessionId: "a", title: "New title" }];
    assert.deepEqual(tabsToSave(saved, live, ["Old title"]), live);
  });
  it("matches each unrestored label to one saved tab", () => {
    const saved = [{ sessionId: "a", title: "New chat" }, { sessionId: "b", title: "New chat" }];
    assert.deepEqual(tabsToSave(saved, [], ["New chat"]), [{ sessionId: "a", title: "New chat" }]);
  });
});
