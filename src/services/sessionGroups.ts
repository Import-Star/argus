import type { SessionColumn } from "../types";

export type GroupOf = Record<string, string>;

export interface GroupableCard {
  record: { sessionId: string; startedAt: number };
  column: SessionColumn;
}

export interface CardGroup<T> {
  id: string;
  members: T[];
  column: SessionColumn;
  summary: string;
}

const URGENCY: SessionColumn[] = ["needs-you", "working", "scheduled", "pr-open", "idle", "archived"];
const LABEL: Record<SessionColumn, string> = {
  "needs-you": "needs you",
  working: "working",
  scheduled: "scheduled",
  "pr-open": "PR open",
  idle: "idle",
  archived: "archived"
};

export function groupColumn(columns: readonly SessionColumn[]): SessionColumn {
  return URGENCY.find((column) => columns.includes(column)) ?? "idle";
}

export function groupSummary(columns: readonly SessionColumn[]): string {
  return URGENCY.map((column) => ({ column, count: columns.filter((entry) => entry === column).length }))
    .filter(({ count }) => count > 0)
    .map(({ column, count }) => `${count} ${LABEL[column]}`)
    .join(" · ");
}

// The group's own session first, then the rest in the order they joined.
export function membersOf(groupOf: GroupOf, sessionId: string): string[] {
  const groupId = groupOf[sessionId];
  if (!groupId) {
    return [sessionId];
  }
  const ids = Object.keys(groupOf).filter((id) => groupOf[id] === groupId);
  return ids.includes(groupId) ? [groupId, ...ids.filter((id) => id !== groupId)] : ids;
}

// Only groups with two or more sessions still on the board; a lone member renders as a normal card.
export function groupCards<T extends GroupableCard>(cards: readonly T[], groupOf: GroupOf): CardGroup<T>[] {
  const byId = new Map(cards.map((card) => [card.record.sessionId, card]));
  const seen = new Set<string>();
  const groups: CardGroup<T>[] = [];
  for (const card of cards) {
    const groupId = groupOf[card.record.sessionId];
    if (!groupId || seen.has(groupId)) {
      continue;
    }
    seen.add(groupId);
    const members = membersOf(groupOf, card.record.sessionId)
      .map((id) => byId.get(id))
      .filter((member): member is T => member !== undefined);
    if (members.length < 2) {
      continue;
    }
    const columns = members.map((member) => member.column);
    groups.push({ id: groupId, members, column: groupColumn(columns), summary: groupSummary(columns) });
  }
  return groups;
}

export function addToGroup(groupOf: GroupOf, newSessionId: string, existingSessionId: string): GroupOf {
  const groupId = groupOf[existingSessionId] ?? existingSessionId;
  return { ...groupOf, [existingSessionId]: groupId, [newSessionId]: groupId };
}

export function pruneGroups(groupOf: GroupOf, removed: ReadonlySet<string>): GroupOf {
  return Object.fromEntries(Object.entries(groupOf).filter(([id]) => !removed.has(id)));
}
