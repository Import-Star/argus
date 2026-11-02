import type { ConfigSetting } from "../configUsage";

export interface ConfigPanelData {
  settings: ConfigSetting[];
  // Explicitly set values only; the CLI keeps defaults out of its settings.
  values: Record<string, string>;
  error?: string;
}
