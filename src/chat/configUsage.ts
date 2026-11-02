export interface ConfigSetting {
  key: string;
  kind: "boolean" | "enum" | "text";
  options: string[];
}

// Reads the settings list in the CLI's bare `/config` reply: one `  key=a|b|c` line each, `<value>` for free text.
export function parseConfigUsage(text: string): ConfigSetting[] {
  return text.split("\n").flatMap((line) => {
    const match = /^\s+(\w+)=(.+)$/.exec(line);
    if (!match) {
      return [];
    }
    const value = match[2].trim();
    const options = value.startsWith("<") ? [] : value.split("|");
    const boolean = options.length === 2 && options.includes("true") && options.includes("false");
    return [{ key: match[1], kind: boolean ? "boolean" : options.length > 0 ? "enum" : "text", options } satisfies ConfigSetting];
  });
}
