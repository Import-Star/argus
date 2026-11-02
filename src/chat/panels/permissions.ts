import type { SettingsFile } from "../settingsJson";

export const RULE_LISTS = ["allow", "ask", "deny", "folders"] as const;
export type RuleList = (typeof RULE_LISTS)[number];

// The settings key each tab edits, under `permissions`.
const KEYS: Record<RuleList, string> = { allow: "allow", ask: "ask", deny: "deny", folders: "additionalDirectories" };

export interface Rule {
  text: string;
  file: string;
  label: string;
}

export interface PermissionsPanelData {
  rules: Record<RuleList, Rule[]>;
  files: { label: string; description: string; file: string; exists: boolean; error?: string }[];
  // Folders added to this chat with /add-dir; they are not in a settings file.
  sessionFolders: string[];
}

function listIn(json: Record<string, unknown>, list: RuleList): string[] {
  const permissions = json.permissions;
  const value = typeof permissions === "object" && permissions !== null ? (permissions as Record<string, unknown>)[KEYS[list]] : undefined;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function collectRules(files: SettingsFile[]): Record<RuleList, Rule[]> {
  const rules = { allow: [], ask: [], deny: [], folders: [] } as Record<RuleList, Rule[]>;
  for (const list of RULE_LISTS) {
    rules[list] = files.flatMap((file) => listIn(file.json, list).map((text) => ({ text, file: file.file, label: file.label })));
  }
  return rules;
}

export function addRule(json: Record<string, unknown>, list: RuleList, text: string): Record<string, unknown> {
  const rule = text.trim();
  const current = listIn(json, list);
  if (!rule || current.includes(rule)) {
    return json;
  }
  const permissions = typeof json.permissions === "object" && json.permissions !== null ? (json.permissions as Record<string, unknown>) : {};
  return { ...json, permissions: { ...permissions, [KEYS[list]]: [...current, rule] } };
}

export function removeRule(json: Record<string, unknown>, list: RuleList, text: string): Record<string, unknown> {
  const current = listIn(json, list);
  if (!current.includes(text)) {
    return json;
  }
  return { ...json, permissions: { ...(json.permissions as Record<string, unknown>), [KEYS[list]]: current.filter((item) => item !== text) } };
}
