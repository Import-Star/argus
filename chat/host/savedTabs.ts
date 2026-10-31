// A single chat tab as it was last labelled, so a tab VS Code hasn't restored yet can be found again by its label.
export interface SavedTab {
  sessionId: string;
  title: string;
}

// Chat tabs that no live panel accounts for: the ones VS Code is holding until they're first shown.
export function unrestored<T extends { label: string }>(tabs: readonly T[], liveTitles: readonly string[]): T[] {
  const claimed = countOf(liveTitles);
  return tabs.filter((tab) => !take(claimed, tab.label));
}

// Live single tabs, plus last run's tabs that are still open and not restored yet.
export function tabsToSave(saved: readonly SavedTab[], live: readonly SavedTab[], unrestoredLabels: readonly string[]): SavedTab[] {
  const liveIds = new Set(live.map((tab) => tab.sessionId));
  const left = countOf(unrestoredLabels);
  return [...live, ...saved.filter((tab) => !liveIds.has(tab.sessionId) && take(left, tab.title))];
}

function countOf(labels: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  labels.forEach((label) => counts.set(label, (counts.get(label) ?? 0) + 1));
  return counts;
}

function take(counts: Map<string, number>, label: string): boolean {
  const count = counts.get(label) ?? 0;
  counts.set(label, count - 1);
  return count > 0;
}
