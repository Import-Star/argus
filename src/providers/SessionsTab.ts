import * as vscode from "vscode";
import { ArgusTab, SessionCard, SessionChip, TabHandle } from "../types";
import { ArchiveCleanupRegistry, archiveWithCleanup } from "../services/archiveSession";
import { SessionChipsRegistry } from "../api";
import { newChat, openWorktree } from "../services/openSession";
import { SessionStore } from "../services/SessionStore";

interface WireChip {
  text: string;
  tooltip?: string;
}

interface WireSessionCard extends SessionCard {
  chips: WireChip[];
}

type FromWebview =
  | { type: "ready" }
  | { type: "newChat" }
  | { type: "refreshSessions" }
  | { type: "markSessionRead"; sessionId: string }
  | { type: "archiveSession"; sessionId: string }
  | { type: "unarchiveSession"; sessionId: string }
  | { type: "openWorktree"; folder: string }
  | { type: "chipClick"; sessionId: string; index: number }
  | { type: "search"; query: string };

// The built-in Sessions tab: registered through the same registerTab API a plugin uses (order 0), so it gets
// no special treatment from ControlCenter beyond going first.
export function createSessionsTab(
  extensionUri: vscode.Uri,
  sessions: SessionStore,
  chips: SessionChipsRegistry,
  archiveCleanup: ArchiveCleanupRegistry
): { tab: ArgusTab; attach(handle: TabHandle): void; disposables: vscode.Disposable[] } {
  let handle: TabHandle | undefined;

  const push = () => {
    if (!handle) {
      return;
    }
    const cards = sessions.getCards();
    const wire: WireSessionCard[] = cards.map((card) => ({
      ...card,
      chips: chips.chipsFor(card).map((chip) => ({ text: chip.text, tooltip: chip.tooltip }))
    }));
    handle.post({ type: "sessions", cards: wire, refreshedAt: sessions.prsRefreshedAt });
    handle.setBadge(sessions.needsYou().length || undefined);
  };

  const disposables: vscode.Disposable[] = [sessions.onDidChange(() => push()), chips.onDidRefresh(() => push())];

  const findCard = (sessionId: string): SessionCard | undefined => sessions.getCards().find((candidate) => candidate.record.sessionId === sessionId);

  const tab: ArgusTab = {
    id: "sessions",
    title: "Sessions",
    order: 0,
    script: vscode.Uri.joinPath(extensionUri, "media", "sessions.js"),
    onMessage: async (message: unknown) => {
      const msg = message as FromWebview;
      switch (msg.type) {
        case "ready":
          push();
          return;
        case "newChat":
          await newChat();
          return;
        case "refreshSessions":
          await sessions.refreshPrs();
          return;
        case "markSessionRead":
          sessions.markRead(msg.sessionId);
          return;
        case "archiveSession":
          await archiveWithCleanup(sessions, archiveCleanup, msg.sessionId);
          return;
        case "unarchiveSession":
          sessions.setArchived(msg.sessionId, false);
          return;
        case "openWorktree":
          await openWorktree(msg.folder);
          return;
        case "search": {
          const matches = await sessions.searchTranscripts(msg.query);
          handle?.post({ type: "searchResults", query: msg.query, matches: Object.fromEntries(matches) });
          return;
        }
        case "chipClick": {
          const card = findCard(msg.sessionId);
          if (!card) {
            return;
          }
          const resolved: SessionChip[] = chips.chipsFor(card);
          const chip = resolved[msg.index];
          if (chip?.command) {
            await vscode.commands.executeCommand(chip.command.command, ...(chip.command.arguments ?? []));
          }
          return;
        }
        default:
          return;
      }
    }
  };

  return {
    tab,
    attach(h: TabHandle) {
      handle = h;
      push();
    },
    disposables
  };
}
