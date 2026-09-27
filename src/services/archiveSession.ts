import { execFile } from "child_process";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";
import { CleanupItem, SessionCard } from "../types";
import { output } from "./log";
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

async function removeWorktree(folder: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", folder, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const repo = path.dirname(stdout.trim());
    // No --force: a worktree with uncommitted changes is kept and reported.
    await execFileAsync("git", ["-C", repo, "worktree", "remove", folder]);
    return undefined;
  } catch (error) {
    return `${path.basename(folder)}: ${(error as { stderr?: string }).stderr?.trim() || String(error)}`;
  }
}

export async function archiveWithCleanup(sessions: SessionStore, cleanup: ArchiveCleanupRegistry, sessionId: string): Promise<void> {
  const card = sessions.getCards().find((candidate) => candidate.record.sessionId === sessionId);
  if (!card) {
    return;
  }

  const cleanupItems = await cleanup.collect(card);
  const sharedWith = new Set(
    sessions
      .getCards()
      .filter((other) => other.record.sessionId !== sessionId && other.column !== "archived")
      .flatMap((other) => other.record.worktrees ?? [])
  );
  const worktrees = (card.record.worktrees ?? []).filter((folder) => !sharedWith.has(folder));

  if (cleanupItems.length > 0 || worktrees.length > 0) {
    const lines = [...cleanupItems.map((item) => item.label), ...worktrees.map((folder) => `Remove worktree: ${folder}`)];
    const choice = await vscode.window.showWarningMessage(
      `Archive "${card.record.title ?? "chat"}"?`,
      { modal: true, detail: lines.join("\n") },
      "Archive and clean up",
      "Archive only"
    );
    if (!choice) {
      return;
    }
    if (choice === "Archive and clean up") {
      for (const item of cleanupItems) {
        try {
          await item.run();
        } catch (error) {
          void vscode.window.showWarningMessage(`Argus: ${item.label} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const failures = (await Promise.all(worktrees.map(removeWorktree))).filter((failure): failure is string => Boolean(failure));
      if (failures.length > 0) {
        void vscode.window.showWarningMessage(`Argus: worktree not removed. ${failures.join(" | ")}`);
      }
    }
  }
  sessions.setArchived(sessionId, true);
}
