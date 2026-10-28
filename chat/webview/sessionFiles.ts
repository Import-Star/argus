import type { SDKMessage } from "../../src/chat/protocol";

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

// Files the session edited that live under cwd, relative to it, in first-edit order. Failed edits don't count.
export function sessionFiles(messages: SDKMessage[], cwd?: string): string[] {
  const edits = new Map<string, string>();
  for (const message of messages) {
    const content = message.type === "assistant" || message.type === "user" ? message.message.content : undefined;
    for (const block of Array.isArray(content) ? content : []) {
      if (block.type === "tool_use" && EDIT_TOOLS.has(block.name)) {
        const input = block.input as { file_path?: unknown; notebook_path?: unknown };
        const file = input.file_path ?? input.notebook_path;
        if (typeof file === "string") {
          edits.set(block.id, file);
        }
      } else if (block.type === "tool_result" && block.is_error) {
        edits.delete(block.tool_use_id);
      }
    }
  }
  const files = [...edits.values()]
    .map((file) => (isAbsolutePath(file) ? (cwd ? relativeTo(file, cwd) : undefined) : file.replace(/\\/g, "/")))
    .filter((file): file is string => file !== undefined && !file.startsWith("../"));
  return [...new Set(files)];
}

const DRIVE = /^[a-z]:[\\/]/i;

// The CLI reports paths in the platform's own form: "C:\proj\a.ts" on Windows, "/proj/a.ts" elsewhere.
export function isAbsolutePath(file: string): boolean {
  return file.startsWith("/") || file.startsWith("\\") || DRIVE.test(file);
}

// `file` relative to `cwd` with "/" separators, or undefined when it is not under cwd. Windows paths ignore case.
export function relativeTo(file: string, cwd: string): string | undefined {
  const normal = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "");
  const root = normal(cwd);
  if (!root) {
    return undefined;
  }
  const target = normal(file);
  const prefix = `${root}/`;
  const windows = DRIVE.test(cwd) || DRIVE.test(file);
  const inside = windows ? target.toLowerCase().startsWith(prefix.toLowerCase()) : target.startsWith(prefix);
  return inside ? target.slice(prefix.length) : undefined;
}

// A dropped file:// URI as a path relative to cwd, or as an absolute path in the platform's own form.
export function uriToPath(uri: string, cwd: string): string | undefined {
  if (!uri.startsWith("file://")) {
    return undefined;
  }
  let file: string;
  try {
    const url = new URL(uri);
    file = decodeURIComponent(url.pathname);
    if (/^\/[a-z]:\//i.test(file)) {
      file = file.slice(1).replace(/\//g, "\\");
    } else if (url.host) {
      file = `\\\\${url.host}${file.replace(/\//g, "\\")}`;
    }
  } catch {
    return undefined;
  }
  return relativeTo(file, cwd) ?? file;
}
