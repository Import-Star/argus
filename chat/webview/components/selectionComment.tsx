import { useEffect, useState } from "preact/hooks";
import "./selectionComment.css";

export interface TextSelection {
  quote: string;
  range: Range;
  top: number;
  left: number;
}

const LINE = "li, p, h1, h2, h3, h4, h5, h6, tr, .code-block, blockquote";
const HOLDER = "comment-holder";

const marks = new Highlight();
CSS.highlights.set("comment", marks);

export function useHighlight(ranges: Range[]): void {
  useEffect(() => {
    ranges.forEach((range) => marks.add(range));
    return () => ranges.forEach((range) => marks.delete(range));
  }, [ranges]);
}

function elementOf(node: Node): Element {
  return node instanceof Element ? node : node.parentElement!;
}

function selectionIn(host: HTMLElement, within: string): TextSelection | undefined {
  const picked = window.getSelection();
  const quote = picked?.toString().trim();
  const inside = (node: Node | null) => !!node && !!elementOf(node).closest(within) && !elementOf(node).closest(`.${HOLDER}`) && host.contains(node);
  if (!picked || picked.isCollapsed || !quote || !inside(picked.anchorNode) || !inside(picked.focusNode)) {
    return undefined;
  }
  const range = picked.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  const box = host.getBoundingClientRect();
  return { quote, range: range.cloneRange(), top: rect.bottom - box.top + host.scrollTop + 4, left: Math.max(0, rect.left - box.left) };
}

export function useTextSelection(within: string, enabled = true) {
  const [selection, setSelection] = useState<TextSelection>();
  const onMouseUp = (event: MouseEvent) => setSelection(enabled ? selectionIn(event.currentTarget as HTMLElement, within) : undefined);
  const clear = () => {
    setSelection(undefined);
    window.getSelection()?.removeAllRanges();
  };
  return { selection, onMouseUp, clear };
}

export function AddComment({ selection, onAdd }: { selection?: TextSelection; onAdd(selection: TextSelection): void }) {
  if (!selection) {
    return null;
  }
  return (
    <button type="button" class="primary comment-add" style={{ top: `${selection.top}px`, left: `${selection.left}px` }} onMouseDown={(event) => event.preventDefault()} onClick={() => onAdd(selection)}>
      Comment
    </button>
  );
}

// Inside a list item, not after it, so the card stays in the list.
export function commentHolder(range: Range): HTMLElement {
  // A triple-click ends the range at offset 0 of the next line.
  const end = elementOf(range.endOffset === 0 ? range.startContainer : range.endContainer);
  const line = end.closest<HTMLElement>(LINE) ?? end.closest<HTMLElement>(".tr-text")!;
  const holder = document.createElement(line.matches("tr") ? "tr" : "div");
  holder.className = HOLDER;
  if (line.matches("tr")) {
    holder.innerHTML = `<td colspan="${line.children.length}"></td>`;
  }
  if (line.matches("li")) {
    line.insertBefore(holder, line.querySelector(":scope > ul, :scope > ol"));
  } else {
    let last: Element = line;
    while (last.nextElementSibling?.classList.contains(HOLDER)) last = last.nextElementSibling;
    last.after(holder);
  }
  return (holder.querySelector("td") ?? holder) as HTMLElement;
}

export function removeHolder(target: HTMLElement): void {
  target.closest(`.${HOLDER}`)?.remove();
}

// Finds `quote` in the text under `root`, ignoring whitespace (a selection's text has line breaks the DOM doesn't).
export function findQuote(root: Element, quote: string): Range | undefined {
  const chars: { node: Text; offset: number }[] = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (node) => (node.parentElement?.closest(`.${HOLDER}`) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    for (let offset = 0; offset < node.data.length; offset++) {
      if (!/\s/.test(node.data[offset])) {
        chars.push({ node, offset });
        text += node.data[offset];
      }
    }
  }
  const needle = quote.replace(/\s+/g, "");
  const at = text.indexOf(needle);
  if (at < 0 || needle === "") {
    return undefined;
  }
  const first = chars[at];
  const last = chars[at + needle.length - 1];
  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  return range;
}
