import type { Finding, Item } from "./transcript";

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

// A forked /code-review returns its findings as this CLI-rendered text instead of a ReportFindings call.
export function findingsFromText(text: string, id: string): Item[] | undefined {
  const heading = /^(\d+) findings?, most severe first:$/m.exec(text);
  if (!heading) {
    return undefined;
  }
  const entries = text.slice(heading.index + heading[0].length).split(/^\d+\. (?=`)/m).slice(1);
  const findings = entries.flatMap((entry): Finding[] => {
    const match = /^`([^`]+?)(?::(\d+))?`: ([\s\S]+?)\n\n\s*Failure scenario: ([\s\S]+)$/.exec(entry.trim());
    return match ? [{ file: match[1], line: match[2] ? Number(match[2]) : undefined, title: match[3].trim(), summary: match[3].trim(), failureScenario: match[4].trim() }] : [];
  });
  if (findings.length === 0 || findings.length !== Number(heading[1]) || findings.length !== entries.length) {
    return undefined;
  }
  const preamble = text.slice(0, heading.index).trim();
  const findingsItem: Item = { kind: "findings", id, findings, pending: false };
  return preamble ? [{ kind: "note", id: `${id}:intro`, text: preamble, tone: "muted", reply: true }, findingsItem] : [findingsItem];
}
