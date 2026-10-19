import { execFile } from "child_process";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";
import { CleanupItem, SessionCard } from "../types";
import { output } from "./log";
import { openClaudeTab } from "./openSession";
import { SessionStore } from "./SessionStore";

const execFileAsync = promisify(execFile);

// Registry behind ArgusApi.registerArchiveCleanup: plugins contribute extra items offered when a session is
// archived (e.g. "remove work card: ..."), alongside the worktree removals core always offers.
export class ArchiveCleanupRegistry {
  private readonly providers = new Set<(card: SessionCard) => Promise<CleanupItem[]> | CleanupItem[]>();

  public register(provider: (card: SessionCard) => Promise<CleanupItem[]> | CleanupItem[]): vscode.Disposable {
    this.providers.add(provider);
    return { dispose: () => this.providers.delete(provider) };
  }

  // A provider's failure must not block archiving: log it and move on.
  public async collect(card: SessionCard): Promise<CleanupItem[]> {
    const results = await Promise.allSettled([...this.providers].map((provider) => provider(card)));
    const items: CleanupItem[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        items.push(...result.value);
      } else {
        output.appendLine(`${new Date().toISOString()} archive cleanup provider failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      }
    }
    return items;
  }
}

async function uncommittedFiles(folder: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", folder, "status", "--porcelain"]);
    return stdout.split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function removeWorktree(folder: string, force: boolean): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", folder, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const repo = path.dirname(stdout.trim());
    // Double --force also removes worktrees with uncommitted changes or a lock.
    await execFileAsync("git", ["-C", repo, "worktree", "remove", ...(force ? ["--force", "--force"] : []), folder]);
    return undefined;
  } catch (error) {
    return `${path.basename(folder)}: ${(error as { stderr?: string }).stderr?.trim() || String(error)}`;
  }
}

function isClaudeTab(tab: vscode.Tab | undefined): tab is vscode.Tab {
  return tab?.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith("claudeVSCodePanel");
}

function activeClaudeTabTitled(title: string): Promise<vscode.Tab | undefined> {
  return new Promise((resolve) => {
    const done = (tab: vscode.Tab | undefined) => {
      clearTimeout(timer);
      listener.dispose();
      resolve(tab);
    };
    const timer = setTimeout(() => done(undefined), 2000);
    const listener = vscode.window.tabGroups.onDidChangeTabs(({ changed, opened }) => {
      const tab = [...changed, ...opened].find((candidate) => isClaudeTab(candidate) && candidate.isActive && candidate.label === title);
      if (tab) {
        done(tab);
      }
    });
  });
}

// Tabs carry no session id, so the title only tells us a tab may be open; reopening the session brings its tab to
// the front, but Claude doesn't wait for that, so watch for the switch instead of reading the active tab.
async function closeChatTab(card: SessionCard): Promise<void> {
  const title = card.record.title;
  const match = vscode.window.tabGroups.all.flatMap((group) => group.tabs).find((tab) => isClaudeTab(tab) && tab.label === title);
  if (!title || !match) {
    return;
  }
  let target: vscode.Tab | undefined = match;
  if (!match.isActive) {
    const switched = activeClaudeTabTitled(title);
    await openClaudeTab(card.record.sessionId, undefined, match.group.viewColumn);
    target = await switched;
  }
  if (target) {
    await vscode.window.tabGroups.close(target);
  }
}

export async function archiveWithCleanup(sessions: SessionStore, cleanup: ArchiveCleanupRegistry, sessionId: string): Promise<void> {
  await archiveManyWithCleanup(sessions, cleanup, [sessionId]);
}

// Archives several sessions with one confirmation covering all their cleanup (plugin items and worktrees no other
// active session uses). Sessions with nothing to clean up are archived without asking.
export async function archiveManyWithCleanup(sessions: SessionStore, cleanup: ArchiveCleanupRegistry, sessionIds: readonly string[]): Promise<void> {
  const ids = new Set(sessionIds);
  const cards = sessions.getCards().filter((candidate) => ids.has(candidate.record.sessionId) && candidate.column !== "archived");
  if (cards.length === 0) {
    return;
  }

  const cleanupItems = (await Promise.all(cards.map((card) => cleanup.collect(card)))).flat();
  const sharedWith = new Set(
    sessions
      .getCards()
      .filter((other) => !ids.has(other.record.sessionId) && other.column !== "archived")
      .flatMap((other) => other.record.worktrees ?? [])
  );
  const worktrees = [...new Set(cards.flatMap((card) => card.record.worktrees ?? []))].filter((folder) => !sharedWith.has(folder));

  if (cleanupItems.length > 0 || worktrees.length > 0) {
    const dirty = await Promise.all(worktrees.map(uncommittedFiles));
    const lines = [
      ...cleanupItems.map((item) => item.label),
      ...worktrees.map((folder, i) => `Remove worktree: ${folder}${dirty[i] ? ` (${dirty[i]} uncommitted file${dirty[i] === 1 ? "" : "s"})` : ""}`)
    ];
    const forceLabel = "Archive and delete uncommitted files";
    const choice = await vscode.window.showWarningMessage(
      cards.length === 1 ? `Archive "${cards[0].record.title ?? "chat"}"?` : `Archive ${cards.length} chats?`,
      { modal: true, detail: lines.join("\n") },
      "Archive and clean up",
      ...(dirty.some(Boolean) ? [forceLabel] : []),
      "Archive only"
    );
    if (!choice) {
      return;
    }
    if (choice !== "Archive only") {
      for (const item of cleanupItems) {
        try {
          await item.run();
        } catch (error) {
          void vscode.window.showWarningMessage(`Argus: ${item.label} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const failures = (await Promise.all(worktrees.map((folder) => removeWorktree(folder, choice === forceLabel)))).filter((failure): failure is string => Boolean(failure));
      if (failures.length > 0) {
        void vscode.window.showWarningMessage(`Argus: worktree not removed. ${failures.join(" | ")}`);
      }
    }
  }
  sessions.setArchivedMany(cards.map((card) => card.record.sessionId), true);
  for (const card of cards) {
    await closeChatTab(card);
  }
}
