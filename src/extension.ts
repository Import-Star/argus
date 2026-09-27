import * as vscode from "vscode";
import { createApi, SessionChipsRegistry } from "./api";
import { AttentionNotifier } from "./providers/AttentionNotifier";
import { AttentionStatusBar } from "./providers/AttentionStatusBar";
import { ControlCentre } from "./providers/ControlCentre";
import { SessionTreeProvider } from "./providers/SessionTreeProvider";
import { createSessionsTab } from "./providers/SessionsTab";
import { ArchiveCleanupRegistry, archiveWithCleanup } from "./services/archiveSession";
import { GhPrSyncService } from "./services/GhPrSyncService";
import { checkNode, installHooks, removeHooks } from "./services/HookInstaller";
import { newChat, openSession, openWorktree } from "./services/openSession";
import { renameSessionPrompt, SessionStore } from "./services/SessionStore";
import { UsageStatusBar } from "./providers/UsageStatusBar";
import { UsageService } from "./services/UsageService";
import { ArgusApi, SessionCard } from "./types";

type TreeNode = { kind: "session"; card: SessionCard } | { kind: "group" } | SessionCard;

function cardOf(arg: unknown): SessionCard | undefined {
  const node = arg as TreeNode | undefined;
  if (!node) {
    return undefined;
  }
  if ("kind" in node) {
    return node.kind === "session" ? node.card : undefined;
  }
  return node;
}

export function activate(context: vscode.ExtensionContext): ArgusApi {
  const prSync = new GhPrSyncService();
  const sessions = new SessionStore(prSync);
  const controlCentre = new ControlCentre(context);
  const chips = new SessionChipsRegistry();
  const archiveCleanup = new ArchiveCleanupRegistry();

  const api = createApi({ sessions, prSync, controlCentre, chips, archiveCleanup });

  const sessionsTab = createSessionsTab(context.extensionUri, sessions, chips, archiveCleanup);
  const sessionsTabHandle = api.registerTab(sessionsTab.tab);
  sessionsTab.attach(sessionsTabHandle);

  const tree = new SessionTreeProvider(sessions);
  const treeView = vscode.window.createTreeView("argusSessions", { treeDataProvider: tree });
  tree.attach(treeView);
  const status = new AttentionStatusBar(sessions);
  context.subscriptions.push(new AttentionNotifier(sessions));

  context.subscriptions.push(sessions, controlCentre, treeView, tree, status, sessionsTabHandle, ...sessionsTab.disposables);

  const register = (command: string, handler: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(command, handler));

  // Plan usage reads Claude Code's local sign-in, so it is opt-in (argus.usage.enabled) and toggles without a reload.
  let usage: { service: UsageService; bar: UsageStatusBar } | undefined;
  const applyUsageSetting = () => {
    const config = vscode.workspace.getConfiguration("argus.usage");
    if (config.get<boolean>("enabled", false) && !usage) {
      const service = new UsageService(Math.max(1, config.get<number>("refreshMinutes", 5)) * 60_000);
      usage = { service, bar: new UsageStatusBar(service) };
    } else if (!config.get<boolean>("enabled", false) && usage) {
      usage.bar.dispose();
      usage.service.dispose();
      usage = undefined;
    }
  };
  applyUsageSetting();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("argus.usage.enabled")) {
        applyUsageSetting();
      }
    }),
    { dispose: () => { usage?.bar.dispose(); usage?.service.dispose(); } }
  );
  register("argus.usage.show", async () => {
    if (usage) {
      usage.bar.show();
      return;
    }
    const choice = await vscode.window.showInformationMessage(
      "Argus: Claude plan usage is off. It reads the Claude Code sign-in on this machine and calls Anthropic's usage endpoint.",
      "Turn On"
    );
    if (choice) {
      await vscode.workspace.getConfiguration("argus.usage").update("enabled", true, vscode.ConfigurationTarget.Global);
    }
  });
  register("argus.usage.refresh", () => usage?.service.refresh());

  register("argus.openControlCentre", (tabId?: unknown) => api.openControlCentre(typeof tabId === "string" ? tabId : undefined));
  register("argus.sessions.newChat", () => newChat());
  register("argus.sessions.refresh", () => sessions.refreshPrs());
  register("argus.sessions.open", async (arg) => {
    const card = cardOf(arg);
    if (card) {
      sessions.markRead(card.record.sessionId);
      await openSession(card);
    }
  });
  register("argus.sessions.rename", async (arg) => {
    const card = cardOf(arg);
    if (card) {
      await renameSessionPrompt(sessions, card.record.sessionId);
    }
  });
  register("argus.sessions.markRead", (arg) => {
    const card = cardOf(arg);
    if (card) {
      sessions.markRead(card.record.sessionId);
    }
  });
  register("argus.sessions.archive", async (arg) => {
    const card = cardOf(arg);
    if (card) {
      await archiveWithCleanup(sessions, archiveCleanup, card.record.sessionId);
    }
  });
  register("argus.sessions.unarchive", (arg) => {
    const card = cardOf(arg);
    if (card) {
      sessions.setArchived(card.record.sessionId, false);
    }
  });
  register("argus.sessions.openWorktree", async (arg) => {
    const node = arg as { kind?: string; folder?: string } | undefined;
    if (node?.folder) {
      await openWorktree(node.folder);
    }
  });
  register("argus.sessions.showAttention", () => status.showPicker(openSession));
  register("argus.sessions.installHooks", () => {
    try {
      const result = installHooks(context.extensionPath);
      const nodeProblem = checkNode();
      if (nodeProblem) {
        void vscode.window.showWarningMessage(`Argus: hooks installed, but ${nodeProblem} Install Node 24+ so sessions can report in.`);
        return;
      }
      void vscode.window.showInformationMessage(
        result.added + result.updated > 0
          ? `Argus: ${result.added} hook(s) added, ${result.updated} updated in ${result.settingsPath}, and a "Rename Session" Claude Code skill installed at ${result.skillPath}. New Claude Code sessions will use them.`
          : "Argus: session tracker hooks and skill are already installed and up to date."
      );
    } catch (error) {
      void vscode.window.showErrorMessage(`Argus: could not install hooks: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  register("argus.sessions.removeHooks", () => {
    try {
      const result = removeHooks();
      void vscode.window.showInformationMessage(
        result.removed > 0 || result.skillRemoved
          ? `Argus: removed ${result.removed} hook(s) from ${result.settingsPath}${result.skillRemoved ? " and the Rename Session skill" : ""}.`
          : "Argus: no session tracker hooks were installed."
      );
    } catch (error) {
      void vscode.window.showErrorMessage(`Argus: could not remove hooks: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  return api;
}

export function deactivate(): void {}
