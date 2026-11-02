// Markdown structure that would render differently from the plain text a slash command printed.
const MARKDOWN = /^#{1,6}\s|^\s*\|.*\|\s*$|^\s*(```|~~~)|\*\*|`|\]\(/m;

// Local command output with no markdown is shown as-is in a monospace block, so aligned columns survive.
export function isPlainOutput(text: string): boolean {
  return !MARKDOWN.test(text);
}
