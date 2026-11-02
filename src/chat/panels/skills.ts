import type { SDKControlGetContextUsageResponse as ContextUsage, SlashCommand } from "@anthropic-ai/claude-agent-sdk";

export interface SkillRow {
  name: string;
  source: string;
  description: string;
  tokens?: number;
}

export interface SkillsPanelData {
  skills: SkillRow[];
  // False when per-skill context costs could not be read.
  hasTokens: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
  userSettings: "user",
  projectSettings: "project",
  localSettings: "local",
  policySettings: "managed",
  syncedSkills: "claude.ai"
};

type SkillMeta = NonNullable<ContextUsage["skills"]>["skillFrontmatter"][number];

export function sourceLabel(skill: Pick<SkillMeta, "source" | "pluginName">): string {
  return skill.pluginName ?? SOURCE_LABELS[skill.source] ?? skill.source;
}

// Command descriptions end in "(user)" or "(claude.ai sync)", or start with "(plugin-name)".
export function splitSource(description: string): { source?: string; description: string } {
  const leading = /^\(([^()]+)\)\s+/.exec(description);
  if (leading) {
    return { source: leading[1], description: description.slice(leading[0].length) };
  }
  const trailing = /\s+\((user|project|local|claude\.ai sync)\)$/.exec(description);
  return trailing ? { source: trailing[1].replace(" sync", ""), description: description.slice(0, trailing.index) } : { description };
}

export function shapeSkills(commands: SlashCommand[], usage: ContextUsage | undefined): SkillsPanelData {
  const described = new Map(commands.map((command) => [command.name, splitSource(command.description)]));
  const frontmatter = usage?.skills?.skillFrontmatter;
  if (frontmatter) {
    const skills = frontmatter.map((skill) => ({
      name: skill.name,
      source: sourceLabel(skill),
      description: described.get(skill.name)?.description ?? "",
      tokens: skill.tokens
    }));
    return { skills: skills.sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name)), hasTokens: true };
  }
  const skills = commands.flatMap((command) => {
    const { source, description } = splitSource(command.description);
    return source ? [{ name: command.name, source, description }] : [];
  });
  return { skills: skills.sort((a, b) => a.name.localeCompare(b.name)), hasTokens: false };
}
