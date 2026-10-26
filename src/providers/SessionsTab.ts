import * as vscode from "vscode";
import { ArgusTab, SessionCard, SessionChip, TabHandle } from "../types";
import { ArchiveCleanupRegistry, archiveManyWithCleanup } from "../services/archiveSession";
import { SessionChipsRegistry } from "../api";
import type { ChatLoader } from "../chat/loader";
import { MULTI_AGENT_SETTING, multiAgentEnabled } from "../chat/multiAgent";
import { answeredInput, toWirePending, type WirePending } from "../chat/pendingWire";
import { newChat, openWorktree } from "../services/openSession";
import { renameSessionPrompt, SessionStore } from "../services/SessionStore";

interface WireChip {
  text: string;
  tooltip?: string;
}

interface WireSessionCard extends SessionCard {
  chips: WireChip[];
  pending?: WirePending[];
}

type FromWebview =
  | { type: "ready" }
  | { type: "newChat" }
  | { type: "refreshSessions" }
  | { type: "markSessionRead"; sessionId: string }
  | { type: "renameSession"; sessionId: string }
  | { type: "archiveSession"; sessionId: string }
  | { type: "unarchiveSession"; sessionId: string }
  | { type: "archiveSessions"; sessionIds: string[] }
  | { type: "unarchiveSessions"; sessionIds: string[] }
  | { type: "openWorktree"; folder: string }
  | { type: "chipClick"; sessionId: string; index: number }
  | { type: "search"; query: string }
  | { type: "chatRespond"; sessionId: string; id: string; decision: "allow" | "always" | "deny"; answers?: unknown }
  | { type: "addToGrid"; sessionId: string }
  | { type: "openGrid"; sessionIds: string[]; groupId?: string };

// The built-in Sessions tab: registered through the same registerTab API a plugin uses (order 0), so it gets
// no special treatment from ControlCenter beyond going first.
export function createSessionsTab(
  extensionUri: vscode.Uri,
  sessions: SessionStore,
  chips: SessionChipsRegistry,
  archiveCleanup: ArchiveCleanupRegistry,
  chat: ChatLoader
): { tab: ArgusTab; attach(handle: TabHandle): void; disposables: vscode.Disposable[] } {
  let handle: TabHandle | undefined;
  const archiving = new Set<string>();

  const push = () => {
    if (!handle) {
      return;
    }
    const cards = sessions.getCards();
    const host = chat.host;
    const wire: WireSessionCard[] = cards.map((card) => {
      const pending = host?.isChatSession(card.record.sessionId) ? host.pendingFor(card.record.sessionId).map(toWirePending) : [];
      return {
        ...card,
        chips: chips.chipsFor(card).map((chip) => ({ text: chip.text, tooltip: chip.tooltip })),
        pending: pending.length ? pending : undefined
      };
    });
    const groups = sessions.getGroups().map((group) => ({
      id: group.id,
      members: group.members.map((member) => member.record.sessionId),
      column: group.column,
      summary: group.summary
    }));
    handle.post({ type: "sessions", cards: wire, groups, refreshedAt: sessions.prsRefreshedAt, archiving: [...archiving], chat: Boolean(host), multiAgent: Boolean(host) && multiAgentEnabled() });
    handle.setBadge(sessions.needsYou().length || undefined);
  };

  let pendingListener = chat.host?.onDidChangePending(() => push());
  const disposables: vscode.Disposable[] = [
    sessions.onDidChange(() => push()),
    chips.onDidRefresh(() => push()),
    chat.onDidChange((host) => {
      pendingListener?.dispose();
      pendingListener = host?.onDidChangePending(() => push());
      push();
    }),
    { dispose: () => pendingListener?.dispose() },
    vscode.workspace.onDidChangeConfiguration((event) => event.affectsConfiguration(MULTI_AGENT_SETTING) && push())
  ];

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
        case "renameSession":
          await renameSessionPrompt(sessions, msg.sessionId);
          return;
        case "archiveSession":
        case "archiveSessions": {
          const ids = (msg.type === "archiveSession" ? [msg.sessionId] : Array.isArray(msg.sessionIds) ? msg.sessionIds : [])
            .filter((id): id is string => typeof id === "string" && !archiving.has(id));
          if (ids.length === 0) {
            return;
          }
          ids.forEach((id) => archiving.add(id));
          push();
          try {
            await archiveManyWithCleanup(sessions, archiveCleanup, ids);
          } finally {
            ids.forEach((id) => archiving.delete(id));
            push();
          }
          return;
        }
        case "unarchiveSessions":
          sessions.setArchivedMany(Array.isArray(msg.sessionIds) ? msg.sessionIds.filter((id) => typeof id === "string") : [], false);
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
        case "chatRespond": {
          const request = chat.host?.pendingFor(msg.sessionId).find((entry) => entry.id === msg.id);
          if (!chat.host || !request) {
            return;
          }
          if (msg.decision === "deny") {
            chat.host.respond(msg.sessionId, msg.id, { behavior: "deny", message: "Denied from the Argus board" });
            return;
          }
          const updatedInput = request.toolName === "AskUserQuestion" ? answeredInput(request.input, msg.answers) : undefined;
          if (request.toolName === "AskUserQuestion" && !updatedInput) {
            return;
          }
          chat.host.respond(msg.sessionId, msg.id, { behavior: "allow", always: msg.decision === "always" || undefined, updatedInput });
          return;
        }
        case "addToGrid":
          chat.host?.addToGrid(msg.sessionId);
          return;
        case "openGrid": {
          const ids = Array.isArray(msg.sessionIds) ? msg.sessionIds.filter((id): id is string => typeof id === "string") : [];
          if (ids.length > 0) {
            chat.host?.openGrid(ids, typeof msg.groupId === "string" ? msg.groupId : undefined);
          }
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
