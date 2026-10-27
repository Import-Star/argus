import { Marked, type Tokens } from "marked";
import { highlightCode } from "./highlight";

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ENTITIES[char]);

export const COPY_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 9h11v11H9zM5 15H4V4h11v1"/></svg>';

const marked = new Marked({
  gfm: true,
  renderer: {
    html: ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text),
    code: ({ text, lang }: Tokens.Code) => {
      const language = lang?.trim().split(/\s+/)[0] || undefined;
      return `<div class="code-block"><button type="button" class="copy-btn" title="Copy code" aria-label="Copy code">${COPY_ICON}</button><pre><code class="hljs">${highlightCode(text, language)}</code></pre></div>\n`;
    },
    image: ({ text }: Tokens.Image) => escapeHtml(text),
    link(this, { href, title, tokens }: Tokens.Link) {
      const inner = this.parser.parseInline(tokens);
      if (!/^(https?:|mailto:)/i.test(href)) {
        return inner;
      }
      // No href: VS Code's webview would otherwise show its own "open external website?" prompt as well.
      return `<a data-href="${escapeHtml(href)}" role="link" tabindex="0" title="${escapeHtml(title || href)}">${inner}</a>`;
    }
  }
});

const cache = new Map<string, string>();

// Raw HTML is escaped and non-http links dropped, so the result is safe for innerHTML.
export function renderMarkdown(text: string): string {
  let html = cache.get(text);
  if (html === undefined) {
    html = marked.parse(text, { async: false });
    if (cache.size > 300) {
      cache.clear();
    }
    cache.set(text, html);
  }
  return html;
}
