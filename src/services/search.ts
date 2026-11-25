import type { SearchItem, SearchSource, SessionCard } from "../types";

// One row in the search overlay. `source` routes a pick back to its source: CHATS or a plugin source's key.
export interface SearchResult {
  source: string;
  group: string;
  id: string;
  title: string;
  detail?: string;
  snippet?: string;
}

export interface ChatSearch {
  getCards(): readonly SessionCard[];
  // Session id to a snippet, for sessions whose transcript contains every term.
  searchTranscripts(query: string): Promise<Map<string, string>>;
  open(sessionId: string): Promise<void>;
}

const CHATS = "chats";
const MAX_PER_GROUP = 50;

export function searchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

// The part of `text` around the first `term`.
export function snippet(text: string, term: string): string {
  const flat = text.replace(/\s+/g, " ");
  const at = flat.toLowerCase().indexOf(term);
  const start = Math.max(0, at - 60);
  const end = Math.min(flat.length, at + term.length + 100);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

// Backs ArgusApi.registerSearchSource and searches chats plus every plugin source. No vscode import, so it is unit tested.
export class SearchRegistry {
  private readonly sources = new Map<string, { source: SearchSource; items: readonly SearchItem[] }>();
  private next = 0;
  private readonly chats: ChatSearch;
  private readonly report: (message: string) => void;

  public constructor(chats: ChatSearch, report: (message: string) => void) {
    this.chats = chats;
    this.report = report;
  }

  public register(source: SearchSource): { set(items: readonly SearchItem[]): void; dispose(): void } {
    const key = `plugin-${this.next++}`;
    this.sources.set(key, { source, items: [] });
    return {
      set: (items) => {
        const entry = this.sources.get(key);
        if (entry) {
          entry.items = items;
        }
      },
      dispose: () => this.sources.delete(key)
    };
  }

  public async search(query: string): Promise<SearchResult[]> {
    const terms = searchTerms(query);
    if (terms.length === 0) {
      return [];
    }
    const transcripts = await this.chats.searchTranscripts(query);
    const chats = this.chats.getCards().flatMap((card): SearchResult[] => {
      const title = card.record.title || card.record.lastPrompt || "Untitled chat";
      const found = transcripts.get(card.record.sessionId);
      if (found === undefined && !matchesAll(`${title}\n${card.repo}`, terms)) {
        return [];
      }
      const detail = card.column === "archived" ? `${card.repo} · archived` : card.repo;
      return [{ source: CHATS, group: "Chats", id: card.record.sessionId, title, detail, snippet: found || undefined }];
    });
    const plugins = [...this.sources].map(([key, { source, items }]) =>
      items.flatMap((item): SearchResult[] => {
        if (!matchesAll(`${item.title}\n${item.detail ?? ""}\n${item.text ?? ""}`, terms)) {
          return [];
        }
        const term = item.text && terms.find((candidate) => item.text?.toLowerCase().includes(candidate));
        return [{ source: key, group: source.label, id: item.id, title: item.title, detail: item.detail, snippet: term ? snippet(item.text ?? "", term) : undefined }];
      })
    );
    return [chats, ...plugins].flatMap((group) => titleMatchesFirst(group, terms).slice(0, MAX_PER_GROUP));
  }

  public async open(source: string, id: string): Promise<void> {
    try {
      if (source === CHATS) {
        await this.chats.open(id);
        return;
      }
      const entry = this.sources.get(source);
      const item = entry?.items.find((candidate) => candidate.id === id);
      if (entry && item) {
        await entry.source.onOpen(item);
      }
    } catch (error) {
      this.report(`Argus: could not open the search result: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function matchesAll(text: string, terms: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return terms.every((term) => lower.includes(term));
}

function titleMatchesFirst(results: SearchResult[], terms: readonly string[]): SearchResult[] {
  const rank = (result: SearchResult) => (matchesAll(result.title, terms) ? 0 : 1);
  return results.sort((a, b) => rank(a) - rank(b));
}
