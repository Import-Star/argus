import type { SettingsFile } from "../settingsJson";

export interface HookEntry {
  type: string;
  command: string;
  timeout?: number;
  file: string;
  label: string;
}

export interface HookGroup {
  event: string;
  matchers: { matcher: string; hooks: HookEntry[] }[];
}

export interface HooksPanelData {
  groups: HookGroup[];
  files: { label: string; file: string; exists: boolean; error?: string }[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

// Groups hooks by event then matcher, merging the same matcher across files. An empty matcher means every tool.
export function collectHooks(files: SettingsFile[]): HookGroup[] {
  const groups = new Map<string, Map<string, HookEntry[]>>();
  for (const { json, file, label } of files) {
    if (!isRecord(json.hooks)) {
      continue;
    }
    for (const [event, entries] of Object.entries(json.hooks)) {
      for (const entry of Array.isArray(entries) ? entries : []) {
        if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
          continue;
        }
        const matcher = typeof entry.matcher === "string" ? entry.matcher : "";
        const byMatcher = groups.get(event) ?? new Map<string, HookEntry[]>();
        const list = byMatcher.get(matcher) ?? [];
        for (const hook of entry.hooks) {
          if (isRecord(hook)) {
            const command = typeof hook.command === "string" ? hook.command : typeof hook.prompt === "string" ? hook.prompt : typeof hook.url === "string" ? hook.url : "";
            list.push({ type: typeof hook.type === "string" ? hook.type : "command", command, timeout: typeof hook.timeout === "number" ? hook.timeout : undefined, file, label });
          }
        }
        byMatcher.set(matcher, list);
        groups.set(event, byMatcher);
      }
    }
  }
  return [...groups].map(([event, byMatcher]) => ({ event, matchers: [...byMatcher].map(([matcher, hooks]) => ({ matcher, hooks })) }));
}

// 0-based line of the event's key in the raw file, so "Open file" can land on it.
export function eventLine(raw: string, event: string): number {
  const index = raw.split("\n").findIndex((line) => line.includes(`"${event}"`));
  return Math.max(index, 0);
}
