export interface LoopRow {
  id: string;
  schedule: string;
  recurring: boolean;
  prompt: string;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

// Reads .claude/scheduled_tasks.json; accepts { tasks: [...] } or a bare array and skips malformed entries.
export function parseScheduledTasks(raw: string): LoopRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { tasks?: unknown } | null)?.tasks;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.flatMap((entry: Record<string, unknown> | null) => {
    const id = text(entry?.id);
    const schedule = text(entry?.cron) || text(entry?.schedule);
    return id && schedule ? [{ id, schedule, recurring: entry?.recurring !== false, prompt: text(entry?.prompt) }] : [];
  });
}

const pad = (n: string) => n.padStart(2, "0");

// Plain words for the common shapes; anything else stays as the raw cron.
export function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return cron;
  }
  const [minute, hour, dom, month, dow] = parts;
  const every = /^\*\/(\d+)$/.exec(minute);
  if (every && hour === "*" && dom === "*" && month === "*" && dow === "*") {
    return `Every ${every[1]} minutes`;
  }
  if (/^\d+$/.test(minute) && hour === "*" && dom === "*" && month === "*" && dow === "*") {
    return minute === "0" ? "Every hour" : `Every hour at :${pad(minute)}`;
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === "*" && month === "*") {
    const time = `${pad(hour)}:${pad(minute)}`;
    if (dow === "*") {
      return `Every day at ${time}`;
    }
    if (dow === "1-5") {
      return `Weekdays at ${time}`;
    }
  }
  return cron;
}
