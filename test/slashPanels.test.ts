import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shapeContext } from "../src/chat/panels/context.ts";
import { shapeSkills, splitSource } from "../src/chat/panels/skills.ts";
import { shapePeriods } from "../src/chat/panels/usage.ts";

describe("shapeContext", () => {
  const usage = {
    totalTokens: 300,
    maxTokens: 1000,
    percentage: 30,
    model: "m",
    categories: [
      { id: "messages", name: "Messages", tokens: 300, color: "", kind: "used" },
      { id: "system_tools_deferred", name: "Deferred", tokens: 500, color: "", kind: "deferred" },
      { id: "free_space", name: "Free space", tokens: 700, color: "", kind: "free" }
    ],
    memoryFiles: [{ path: "/home/u/.claude/CLAUDE.md", type: "User", tokens: 200 }],
    mcpTools: [{ name: "t", serverName: "s", tokens: 0 }],
    agents: [{ agentType: "reviewer", source: "userSettings", tokens: 50 }],
    skills: { totalSkills: 1, includedSkills: 1, tokens: 80, skillFrontmatter: [{ name: "jira", source: "userSettings", tokens: 80 }] }
  };

  it("gives each category its share of the window and ranks items, dropping empty ones", () => {
    const view = shapeContext(usage as never);
    assert.deepEqual(view.segments.map((s) => s.percent), [30, 50, 70]);
    assert.deepEqual(view.items.map((i) => [i.group, i.name]), [["Memory file", ".claude/CLAUDE.md (User)"], ["Skill", "jira"], ["Agent", "reviewer"]]);
  });
});

describe("skills", () => {
  it("splits the source out of a command description", () => {
    assert.deepEqual(splitSource("Do a thing. (user)"), { source: "user", description: "Do a thing." });
    assert.deepEqual(splitSource("(crit) Review code"), { source: "crit", description: "Review code" });
    assert.deepEqual(splitSource("Plain (not a source)"), { description: "Plain (not a source)" });
  });

  it("sorts by context cost and labels sources", () => {
    const commands = [
      { name: "a", description: "A skill (user)", argumentHint: "" },
      { name: "b:c", description: "(b) C skill", argumentHint: "" }
    ];
    const usage = { skills: { skillFrontmatter: [{ name: "a", source: "userSettings", tokens: 5 }, { name: "b:c", source: "plugin", pluginName: "b", tokens: 9 }] } };
    const { skills, hasTokens } = shapeSkills(commands, usage as never);
    assert.equal(hasTokens, true);
    assert.deepEqual(skills.map((s) => [s.name, s.source, s.description, s.tokens]), [["b:c", "b", "C skill", 9], ["a", "user", "A skill", 5]]);
  });

  it("falls back to command descriptions when context usage is unavailable", () => {
    const commands = [
      { name: "z", description: "Z (user)", argumentHint: "" },
      { name: "compact", description: "Compact", argumentHint: "" }
    ];
    const { skills, hasTokens } = shapeSkills(commands, undefined);
    assert.equal(hasTokens, false);
    assert.deepEqual(skills.map((s) => s.name), ["z"]);
  });
});

describe("shapePeriods", () => {
  it("is empty when behaviours are unavailable", () => {
    assert.deepEqual(shapePeriods(null), []);
  });
});
