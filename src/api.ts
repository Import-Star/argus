import * as vscode from "vscode";
import { ArgusApi, ArgusTab, CleanupItem, PrSummary, SessionCard, SessionChip, TabHandle } from "./types";
import { ArchiveCleanupRegistry } from "./services/archiveSession";
import { GhPrSyncService } from "./services/GhPrSyncService";
import { startChat } from "./services/openSession";
import { parsePullRequestLinks } from "./services/PrLinkParser";
import { SessionStore } from "./services/SessionStore";
import { ControlCenter } from "./providers/ControlCenter";

const LINK_PLUGIN = /^[a-z0-9-]+$/;
const LINK_ID = /^[A-Za-z0-9_.-]+$/;

// Backs ArgusApi.registerSessionChips. Chips are recomputed on every render; `refresh()` lets a plugin ask the
// Sessions tab to re-pull them without waiting for the next session change.
export class SessionChipsRegistry {
  private readonly providers = new Set<(card: SessionCard) => SessionChip[] | undefined>();
  private readonly emitter = new vscode.EventEmitter<void>();
  public readonly onDidRefresh = this.emitter.event;

  public register(provider: (card: SessionCard) => SessionChip[] | undefined): vscode.Disposable & { refresh(): void } {
    this.providers.add(provider);
    return {
      dispose: () => this.providers.delete(provider),
      refresh: () => this.emitter.fire()
    };
  }

  public chipsFor(card: SessionCard): SessionChip[] {
    const chips: SessionChip[] = [];
    for (const provider of this.providers) {
      try {
        const result = provider(card);
        if (result) {
          chips.push(...result);
        }
      } catch (error) {
        console.warn(`Argus: a session chip provider threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return chips;
  }
}

export interface ArgusServices {
  sessions: SessionStore;
  prSync: GhPrSyncService;
  controlCenter: ControlCenter;
  chips: SessionChipsRegistry;
  archiveCleanup: ArchiveCleanupRegistry;
}

export function createApi(services: ArgusServices): ArgusApi {
  const { sessions, prSync, controlCenter, chips, archiveCleanup } = services;

  return {
    version: 1,

    sessions: {
      getCards(): readonly SessionCard[] {
        return sessions.getCards();
      },
      onDidChange: sessions.onDidChange,
      async open(sessionId: string): Promise<void> {
        await vscode.commands.executeCommand("argus.sessions.open", { record: { sessionId } });
      },
      async start(options: { prompt: string; link?: { plugin: string; id: string }; viewColumn?: vscode.ViewColumn }): Promise<void> {
        let prompt = options.prompt;
        if (options.link) {
          if (!LINK_PLUGIN.test(options.link.plugin) || !LINK_ID.test(options.link.id)) {
            throw new Error(`Argus: invalid session link {plugin: ${options.link.plugin}, id: ${options.link.id}}.`);
          }
          prompt = `${prompt}\n\n[argus:${options.link.plugin}:${options.link.id}]`;
        }
        await startChat(prompt, options.viewColumn);
      }
    },

    prs: {
      parse(text: string): string[] {
        return parsePullRequestLinks(text).map((ref) => ref.url);
      },
      async get(urls: readonly string[], options?: { refresh?: boolean }): Promise<Map<string, PrSummary>> {
        return prSync.summarize([...urls], options?.refresh === true);
      },
      async available(): Promise<{ ok: boolean; message?: string }> {
        return prSync.checkGhAvailable();
      }
    },

    registerTab(tab: ArgusTab): TabHandle {
      return controlCenter.registerTab(tab);
    },

    async openControlCentre(tabId?: string): Promise<void> {
      await controlCenter.openControlCentre(tabId);
    },

    registerSessionChips(provider: (card: SessionCard) => SessionChip[] | undefined): vscode.Disposable & { refresh(): void } {
      return chips.register(provider);
    },

    registerArchiveCleanup(provider: (card: SessionCard) => Promise<CleanupItem[]> | CleanupItem[]): vscode.Disposable {
      return archiveCleanup.register(provider);
    }
  };
}
