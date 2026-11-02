import type { SDKControlGetUsageResponse as Usage } from "@anthropic-ai/claude-agent-sdk";
import type { PlanUsage } from "../protocol";

export interface Share {
  name: string;
  pct: number;
}

export interface UsagePeriod {
  label: string;
  requests: number;
  sessions: number;
  behaviors: Share[];
  agents: Share[];
  skills: Share[];
}

export interface SessionUsage {
  costUsd: number;
  tokens: number;
  durationMs: number;
}

export interface UsagePanelData {
  // Null when plan limits don't apply to this sign-in; undefined when they could not be read.
  plan: PlanUsage | null | undefined;
  session?: SessionUsage;
  periods: UsagePeriod[];
}

const humanise = (key: string) => {
  const text = key.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

type Behaviors = NonNullable<Usage["behaviors"]>;

export function shapeSession(usage: Usage): SessionUsage {
  const models = Object.values(usage.session.model_usage);
  return {
    costUsd: usage.session.total_cost_usd,
    tokens: models.reduce((sum, m) => sum + m.inputTokens + m.outputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens, 0),
    durationMs: usage.session.total_duration_ms
  };
}

export function shapePeriods(behaviors: Usage["behaviors"]): UsagePeriod[] {
  if (!behaviors) {
    return [];
  }
  const period = (label: string, p: Behaviors["day"]): UsagePeriod => ({
    label,
    requests: p.request_count,
    sessions: p.session_count,
    behaviors: p.behaviors.map((b) => ({ name: humanise(b.key), pct: b.pct })),
    agents: p.agents,
    skills: p.skills
  });
  return [period("Last 24 hours", behaviors.day), period("Last 7 days", behaviors.week)];
}
