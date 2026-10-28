import type { SlashItem } from "../../../src/chat/protocol";

export const MAX_TEXT_BYTES = 200 * 1024;

const TEXT_TYPE = /^text\/|json|xml|javascript|typescript|yaml|toml|x-sh$|sql|csv/;
const TEXT_EXT = /\.(txt|md|markdown|json|jsonc|ya?ml|toml|xml|csv|tsv|log|ini|env|sh|zsh|bash|sql|html?|css|scss|less|[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|tf|tfvars|graphql|gql|prisma|diff|patch|lock|gitignore|dockerfile)$/i;

export function isTextLike(file: { name: string; type: string }): boolean {
  return TEXT_TYPE.test(file.type) || TEXT_EXT.test(file.name);
}

export function fileUris(list: string): string[] {
  return list
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("file://"));
}

export function filterCommands(commands: SlashItem[], query: string): SlashItem[] {
  const q = query.toLowerCase();
  const starts = commands.filter((command) => command.name.toLowerCase().startsWith(q));
  const rest = commands.filter((command) => !command.name.toLowerCase().startsWith(q) && command.name.toLowerCase().includes(q));
  return [...starts, ...rest];
}

export function fenceFile(name: string, content: string): string {
  const longest = Math.max(2, ...[...content.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  return `${name}\n${fence}\n${content.replace(/\n$/, "")}\n${fence}`;
}
