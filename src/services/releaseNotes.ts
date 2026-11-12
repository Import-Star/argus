export interface ReleaseItem {
  text: string;
  image?: { alt: string; path: string };
}

export interface Release {
  version: string;
  highlights: ReleaseItem[];
  changes: ReleaseItem[];
}

// Reads CHANGELOG.md into releases, newest first. Items under a release's "### Highlights" heading are highlights;
// every other item is a change. An item's indented lines are joined onto it, except a highlight's indented
// `![alt](media/whats-new/...)` line, which is its picture.
export function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = [];
  let release: Release | undefined;
  let highlights = false;
  let item: ReleaseItem | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      const version = /^## (\d+\.\d+\.\d+)\s*$/.exec(line)?.[1];
      release = version ? { version, highlights: [], changes: [] } : undefined;
      if (release) {
        releases.push(release);
      }
      highlights = false;
      item = undefined;
    } else if (release && line.startsWith("### ")) {
      highlights = /^### highlights\s*$/i.test(line);
      item = undefined;
    } else if (release && line.startsWith("- ")) {
      item = { text: line.slice(2).trim() };
      (highlights ? release.highlights : release.changes).push(item);
    } else if (release && item && /^\s+\S/.test(line)) {
      const image = highlights ? /^\s+!\[([^\]]*)\]\((media\/whats-new\/[\w.-]+)\)\s*$/.exec(line) : null;
      if (image) {
        item.image = { alt: image[1], path: image[2] };
      } else {
        item.text += ` ${line.trim()}`;
      }
    }
  }
  return releases;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string);
}

// Renders the inline Markdown the changelog uses: `code`, **bold** and [links](https://...).
export function inlineMarkdown(text: string): string {
  const code: string[] = [];
  return escapeHtml(text.replace(/`([^`]+)`/g, (_, inner: string) => `\u0000${code.push(inner) - 1}\u0000`))
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="#" data-url="$2">$1</a>')
    .replace(/\u0000(\d+)\u0000/g, (_, index: string) => `<code>${escapeHtml(code[Number(index)])}</code>`);
}

// The version to show notes for after an update, or undefined. A first install stores the version without showing.
export function versionToAnnounce(current: string, lastSeen: string | undefined, installedBefore: boolean): string | undefined {
  return lastSeen ? (lastSeen !== current ? current : undefined) : installedBefore ? current : undefined;
}
