import * as fs from "fs";
import * as path from "path";
import type { FileChoice } from "./localCommands";

export interface SettingsFile extends FileChoice {
  json: Record<string, unknown>;
  // Set when the file exists but isn't a JSON object; the panel shows it and never writes the file.
  error?: string;
}

export function parseSettings(raw: string | undefined): { json: Record<string, unknown>; error?: string } {
  if (raw === undefined || !raw.trim()) {
    return { json: {} };
  }
  try {
    const json: unknown = JSON.parse(raw);
    if (typeof json === "object" && json !== null && !Array.isArray(json)) {
      return { json: json as Record<string, unknown> };
    }
    return { json: {}, error: "Not a JSON object" };
  } catch (error) {
    return { json: {}, error: error instanceof Error ? error.message : String(error) };
  }
}

export function readRaw(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

export function readSettingsFiles(choices: FileChoice[]): SettingsFile[] {
  return choices.map((choice) => ({ ...choice, ...parseSettings(readRaw(choice.file)) }));
}

export function writeSettings(file: string, json: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}
