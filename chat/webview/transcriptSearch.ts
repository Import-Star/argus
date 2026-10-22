const HIT = "tr-hit";
const CURRENT = "tr-hit-current";

type Registry = { set(name: string, value: unknown): void; delete(name: string): void };

const registry = (): Registry | undefined => (CSS as unknown as { highlights?: Registry }).highlights;
const HighlightClass = (): (new (...ranges: Range[]) => unknown) | undefined => (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;

function textNodes(root: Element): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text);
  }
  return nodes;
}

function pointAt(nodes: Text[], offset: number, end: boolean): [Text, number] {
  let left = offset;
  for (const node of nodes) {
    const length = node.data.length;
    if (left < length || (end && left === length)) {
      return [node, left];
    }
    left -= length;
  }
  const last = nodes[nodes.length - 1];
  return [last, last.data.length];
}

export function findMatches(root: Element, query: string): Range[] {
  const needle = query.toLowerCase();
  const ranges: Range[] = [];
  if (!needle) {
    return ranges;
  }
  for (const item of root.querySelectorAll(".tr-item")) {
    const nodes = textNodes(item);
    const text = nodes.map((node) => node.data).join("").toLowerCase();
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
      const range = document.createRange();
      range.setStart(...pointAt(nodes, at, false));
      range.setEnd(...pointAt(nodes, at + needle.length, true));
      ranges.push(range);
    }
  }
  return ranges;
}

export function paintMatches(ranges: Range[], current: number): void {
  const highlights = registry();
  const Highlight = HighlightClass();
  if (!highlights || !Highlight) {
    return;
  }
  highlights.set(HIT, new Highlight(...ranges));
  highlights.set(CURRENT, new Highlight(...ranges.slice(current, current + 1)));
}

export function clearMatches(): void {
  registry()?.delete(HIT);
  registry()?.delete(CURRENT);
}

export function revealMatch(range: Range | undefined): void {
  const target = range?.startContainer.parentElement;
  target?.scrollIntoView({ block: "center" });
}

// Composer owns its text; the textarea's own input event is its public way in.
export function fillComposer(sessionId: string, text: string): boolean {
  const box = document.getElementById(`cmp-${sessionId}`) as HTMLTextAreaElement | null;
  if (!box) {
    return false;
  }
  box.value = text;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  box.focus();
  box.setSelectionRange(text.length, text.length);
  return true;
}
