export type SettingKind = "boolean" | "enum" | "string" | "number" | "other";

export interface SettingField {
  id: string;
  title: string;
  kind: SettingKind;
  description: string;
  enum?: unknown[];
  enumDescriptions?: string[];
  minimum?: number;
  maximum?: number;
  default: unknown;
  value: unknown;
  userSet: boolean;
  workspaceSet: boolean;
}

export interface SettingGroup {
  key: string;
  title: string;
  fields: SettingField[];
}

export interface SettingValues {
  defaultValue?: unknown;
  globalValue?: unknown;
  workspaceValue?: unknown;
  workspaceFolderValue?: unknown;
}

interface SettingSchema {
  type?: string | string[];
  enum?: unknown[];
  enumDescriptions?: string[];
  minimum?: number;
  maximum?: number;
  default?: unknown;
  description?: string;
  markdownDescription?: string;
}

interface ConfigurationSection {
  properties?: Record<string, SettingSchema>;
}

const FIRST_GROUP = "chat";
const GROUP_TITLES: Record<string, string> = { prs: "Pull requests" };

function humanise(segment: string): string {
  const words = segment.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/\bpr\b/g, "PR");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function kindOf(schema: SettingSchema): SettingKind {
  if (Array.isArray(schema.enum) && schema.type === "string") {
    return "enum";
  }
  if (schema.type === "boolean" || schema.type === "string") {
    return schema.type;
  }
  return schema.type === "number" || schema.type === "integer" ? "number" : "other";
}

export function buildSettingGroups(
  configuration: ConfigurationSection | ConfigurationSection[] | undefined,
  inspect: (id: string) => SettingValues | undefined
): SettingGroup[] {
  const sections = Array.isArray(configuration) ? configuration : configuration ? [configuration] : [];
  const groups = new Map<string, SettingGroup>();

  for (const section of sections) {
    for (const [id, schema] of Object.entries(section.properties ?? {})) {
      const segments = id.split(".");
      const key = segments[1] ?? segments[0];
      const values = inspect(id);
      const group = groups.get(key) ?? { key, title: GROUP_TITLES[key] ?? humanise(key), fields: [] };
      groups.set(key, group);
      group.fields.push({
        id,
        title: humanise(segments[segments.length - 1]),
        kind: kindOf(schema),
        description: schema.markdownDescription ?? schema.description ?? "",
        enum: schema.enum,
        enumDescriptions: schema.enumDescriptions,
        minimum: schema.minimum,
        maximum: schema.maximum,
        default: schema.default,
        value: values?.workspaceFolderValue ?? values?.workspaceValue ?? values?.globalValue ?? values?.defaultValue ?? schema.default,
        userSet: values?.globalValue !== undefined,
        workspaceSet: values?.workspaceValue !== undefined || values?.workspaceFolderValue !== undefined
      });
    }
  }

  return [...groups.values()].sort((a, b) => Number(b.key === FIRST_GROUP) - Number(a.key === FIRST_GROUP));
}
