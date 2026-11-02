export type Severity = "high" | "medium" | "low";

export interface ScenarioPart {
  label: string;
  text: string;
}

const SEVERITY: Record<string, Severity> = {
  correctness: "high",
  security: "high",
  "data-loss": "high",
  "data-integrity": "high",
  concurrency: "high",
  "race-condition": "high",
  auth: "high",
  permissions: "high",
  money: "high",
  hardening: "medium",
  reliability: "medium",
  "error-handling": "medium",
  efficiency: "medium",
  performance: "medium",
  compatibility: "medium",
  "test-coverage": "medium",
  docs: "low",
  documentation: "low",
  duplication: "low",
  reuse: "low",
  simplification: "low",
  cleanup: "low",
  style: "low",
  naming: "low",
  readability: "low",
  maintainability: "low",
  logging: "low"
};

const REPRO = /^(Reproduced|Not reproduced|No repro needed)[:.]?\s*/i;

export function severityOf(category?: string): Severity | undefined {
  return category ? SEVERITY[category.trim().toLowerCase()] : undefined;
}

export function scenarioParts(text: string): ScenarioPart[] {
  const [head, ...rest] = text.trim().split(/\s*\b(Likelihood|Fix):\s*/);
  const parts: ScenarioPart[] = [];
  const repro = REPRO.exec(head);
  if (head) {
    parts.push({ label: repro ? repro[1].replace(/ needed$/i, "") : "Scenario", text: repro ? head.slice(repro[0].length) : head });
  }
  for (let index = 0; index < rest.length; index += 2) {
    parts.push({ label: rest[index], text: rest[index + 1] ?? "" });
  }
  return parts.filter((part) => part.text);
}
