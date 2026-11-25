import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionCard } from "../src/types.ts";
import { SearchRegistry } from "../src/services/search.ts";

const card = (sessionId: string, title: string, column = "idle") => ({ record: { sessionId, title }, repo: "web", column }) as unknown as SessionCard;

function registry(cards: SessionCard[], transcripts: Record<string, string> = {}) {
  const opened: string[] = [];
  const reports: string[] = [];
  const search = new SearchRegistry(
    {
      getCards: () => cards,
      searchTranscripts: async () => new Map(Object.entries(transcripts)),
      open: async (sessionId) => void opened.push(sessionId)
    },
    (message) => reports.push(message)
  );
  return { search, opened, reports };
}

describe("SearchRegistry", () => {
  it("matches every term across title, detail and text, title matches first", async () => {
    const { search } = registry([card("s1", "Fix login"), card("s2", "Deploy", "archived")], { s2: "…the login page…" });
    const handle = search.register({ label: "Work", onOpen: () => {} });
    handle.set([
      { id: "a", title: "Refactor", text: "move the login form to the new page" },
      { id: "b", title: "Login page", detail: "todo" },
      { id: "c", title: "Login", text: "unrelated" }
    ]);

    const results = await search.search("login page");
    assert.deepEqual(
      results.map((r) => [r.group, r.id, r.detail, r.snippet]),
      [
        ["Chats", "s2", "web · archived", "…the login page…"],
        ["Work", "b", "todo", undefined],
        ["Work", "a", undefined, "move the login form to the new page"]
      ]
    );
  });

  it("routes a pick to its source and reports a source that throws", async () => {
    const { search, opened, reports } = registry([card("s1", "Fix login")]);
    const picked: string[] = [];
    search.register({ label: "A", onOpen: (item) => void picked.push(item.id) }).set([{ id: "x", title: "login" }]);
    search.register({ label: "B", onOpen: () => { throw new Error("boom"); } }).set([{ id: "x", title: "login" }]);

    const results = await search.search("login");
    for (const result of results) {
      await search.open(result.source, result.id);
    }
    assert.deepEqual(opened, ["s1"]);
    assert.deepEqual(picked, ["x"]);
    assert.match(reports[0], /boom/);
  });

  it("drops a disposed source's items", async () => {
    const { search } = registry([]);
    const handle = search.register({ label: "A", onOpen: () => {} });
    handle.set([{ id: "x", title: "login" }]);
    handle.dispose();
    assert.deepEqual(await search.search("login"), []);
  });
});
