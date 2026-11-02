export interface DaemonStatus {
  running: boolean;
  fields: { label: string; value: string }[];
}

const FIELDS = [
  { label: "PID", pattern: /^\s*pid\s*[:=]\s*(.+)$/im },
  { label: "Version", pattern: /^\s*version\s*[:=]\s*(.+)$/im },
  { label: "Uptime", pattern: /^\s*uptime\s*[:=]\s*(.+)$/im }
];

export function parseDaemonStatus(output: string): DaemonStatus {
  const running = !/^\s*not running/i.test(output);
  const fields = FIELDS.flatMap(({ label, pattern }) => {
    const match = running ? pattern.exec(output) : null;
    return match ? [{ label, value: match[1].trim() }] : [];
  });
  return { running, fields };
}

export interface ConfigRow {
  key: string;
  value: string;
}

const SECRET_KEY = /token|secret|password|passwd|credential|auth|api[-_]?key|private/i;
const TOKEN_LIKE = /^[A-Za-z0-9+/_=.-]{32,}$/;

const isSecret = (key: string, value: unknown) => SECRET_KEY.test(key) || (typeof value === "string" && TOKEN_LIKE.test(value));

function summarise(key: string, value: unknown): string | undefined {
  if (isSecret(key, value)) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const names = value.map((item) => (typeof item === "string" ? item : (item as { name?: unknown; id?: unknown } | null)?.name ?? (item as { id?: unknown } | null)?.id)).filter((name): name is string => typeof name === "string" && !isSecret("", name));
    return names.length > 0 ? `${value.length}: ${names.join(", ")}` : String(value.length);
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).filter((name) => !isSecret(name, undefined));
    return keys.length > 0 ? keys.join(", ") : "{}";
  }
  return String(value);
}

// One row per top-level key; values that look like secrets are left out.
export function summariseDaemonConfig(raw: string): ConfigRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  return Object.entries(parsed).flatMap(([key, value]) => {
    const summary = summarise(key, value);
    return summary === undefined ? [] : [{ key, value: summary }];
  });
}
