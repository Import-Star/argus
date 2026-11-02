import type { SDKControlGetContextUsageResponse as ContextUsage } from "@anthropic-ai/claude-agent-sdk";

export type SegmentKind = ContextUsage["categories"][number]["kind"];

export interface ContextSegment {
  id: string;
  name: string;
  tokens: number;
  percent: number;
  kind: SegmentKind;
}

export interface ContextItem {
  group: string;
  name: string;
  tokens: number;
}

export interface ContextView {
  total: number;
  max: number;
  percent: number;
  model: string;
  segments: ContextSegment[];
  items: ContextItem[];
}

// Null when the session has no running Claude process to ask.
export type ContextPanelData = ContextView | null;

const MAX_ITEMS = 15;

const lastSegments = (path: string) => path.split(/[\\/]/).slice(-2).join("/");

export function shapeContext(usage: ContextUsage): ContextView {
  const max = usage.maxTokens || 1;
  const items: ContextItem[] = [
    ...usage.memoryFiles.map((file) => ({ group: "Memory file", name: `${lastSegments(file.path)} (${file.type})`, tokens: file.tokens })),
    ...(usage.skills?.skillFrontmatter ?? []).map((skill) => ({ group: "Skill", name: skill.name, tokens: skill.tokens })),
    ...usage.mcpTools.map((tool) => ({ group: "MCP tool", name: `${tool.serverName}: ${tool.name}`, tokens: tool.tokens })),
    ...usage.agents.map((agent) => ({ group: "Agent", name: agent.agentType, tokens: agent.tokens }))
  ];
  return {
    total: usage.totalTokens,
    max: usage.maxTokens,
    percent: usage.percentage,
    model: usage.model,
    segments: usage.categories.map((category, index) => ({
      id: category.id ?? String(index),
      name: category.name,
      tokens: category.tokens,
      percent: (category.tokens / max) * 100,
      kind: category.kind
    })),
    items: items.filter((item) => item.tokens > 0).sort((a, b) => b.tokens - a.tokens).slice(0, MAX_ITEMS)
  };
}
