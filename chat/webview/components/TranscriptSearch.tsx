import type { RefObject } from "preact";
import { Icon } from "./Icon";

const SEARCH = "M21 21l-4.3-4.3 M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z";
const UP = "M6 15l6-6 6 6";
const DOWN = "M6 9l6 6 6-6";
const CLOSE = "M6 6l12 12M18 6L6 18";

interface Props {
  query: string;
  current: number;
  total: number;
  inputRef: RefObject<HTMLInputElement>;
  onQuery(query: string): void;
  onStep(delta: number): void;
  onClose(): void;
}

export function TranscriptSearch({ query, current, total, inputRef, onQuery, onStep, onClose }: Props) {
  const status = total > 0 ? `${current + 1} of ${total}` : query.trim() ? "No results" : "";
  return (
    <div class="tr-search" role="search">
      <Icon d={SEARCH} size={13} />
      <input
        ref={inputRef}
        type="text"
        aria-label="Search conversation"
        placeholder="Search conversation"
        value={query}
        onInput={(event) => onQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onStep(event.shiftKey ? -1 : 1);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      />
      <span class="tr-search-count" role="status" aria-live="polite">
        {status}
      </span>
      <button type="button" class="ghost" aria-label="Previous match" title="Previous (Shift+Enter)" disabled={total === 0} onClick={() => onStep(-1)}>
        <Icon d={UP} />
      </button>
      <button type="button" class="ghost" aria-label="Next match" title="Next (Enter)" disabled={total === 0} onClick={() => onStep(1)}>
        <Icon d={DOWN} />
      </button>
      <button type="button" class="ghost" aria-label="Close search" title="Close (Esc)" onClick={onClose}>
        <Icon d={CLOSE} />
      </button>
    </div>
  );
}
