import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";
import { CleanupItem, SessionCard } from "../types";
import { wslDistro } from "./ComposeMonitor";
import { composeProjects, ownsProject, removeComposeProject } from "./composeStacks";
import { output } from "./log";
import { pathKey, uniquePaths } from "./paths";
import { closeChatSession } from "./openSession";
import { SessionStore } from "./SessionStore";

const execFileAsync = promisify(execFile);

// Registry behind ArgusApi.registerArchiveCleanup: plugins contribute extra items offered when a session is
// archived (e.g. "remove work card: ..."), alongside the worktree removals core always offers.
export class ArchiveCleanupRegistry {
  private readonly providers = new Set<(card: SessionCard) => Promise<CleanupItem[]> | CleanupItem[]>();
  private readonly changed = new vscode.EventEmitter<void>();
  public readonly onDidChangeArchiving = this.changed.event;
  public readonly archiving = new Set<string>();

  public setArchiving(ids: readonly string[], on: boolean): void {
    ids.forEach((id) => (on ? this.archiving.add(id) : this.archiving.delete(id)));
    this.changed.fire();
  }

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
    try {
      await execFileAsync("git", ["-C", repo, "worktree", "remove", ...(force ? ["--force", "--force"] : []), folder]);
    } catch (error) {
      // On Windows git deletes the worktree's `.git` and unregisters it, then stops at a file or folder another
      // process still holds (a chat just stopped, a terminal or dev server inside it), leaving the folder. Once git
      // has let go of it, finish the delete, retrying while the holder exits.
      const listed = (await execFileAsync("git", ["-C", repo, "worktree", "list", "--porcelain"])).stdout;
      const stillListed = listed.split(/\r?\n/).some((line) => line.startsWith("worktree ") && pathKey(line.slice(9)) === pathKey(folder));
      if (stillListed || fs.existsSync(path.join(folder, ".git"))) {
        throw error;
      }
      try {
        await fs.promises.rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
      } catch (rmError) {
        throw Object.assign(new Error(`git removed the worktree but its folder is still in use, delete it once it's free: ${folder}`), { cause: rmError });
      }
    }
    return undefined;
  } catch (error) {
    return `${path.basename(folder)}: ${(error as { stderr?: string }).stderr?.trim() || String(error)}`;
  }
}

export async function deleteWorktree(sessions: SessionStore, folder: string): Promise<void> {
  const dirty = await uncommittedFiles(folder);
  const force = "Delete and discard uncommitted files";
  const choice = await vscode.window.showWarningMessage(
    `Delete worktree ${path.basename(folder)}?`,
    { modal: true, detail: `${folder}${dirty ? `\n${dirty} uncommitted file${dirty === 1 ? "" : "s"} would be lost.` : ""}` },
    ...(dirty ? [force] : ["Delete"])
  );
  if (!choice) {
    return;
  }
  const failure = await removeWorktree(folder, choice === force);
  if (failure) {
    void vscode.window.showWarningMessage(`Argus: worktree not removed. ${failure}`);
  }
  sessions.refresh();
}

export async function archiveWithCleanup(sessions: SessionStore, cleanup: ArchiveCleanupRegistry, sessionId: string): Promise<void> {
  await archiveManyWithCleanup(sessions, cleanup, [sessionId]);
}

// Archives several sessions with one confirmation covering all their cleanup (plugin items and worktrees no other
// active session uses). Sessions with nothing to clean up are archived without asking.
export async function archiveManyWithCleanup(sessions: SessionStore, cleanup: ArchiveCleanupRegistry, sessionIds: readonly string[]): Promise<void> {
  const ids = new Set(sessionIds.filter((id) => !cleanup.archiving.has(id)));
  const cards = sessions.getCards().filter((candidate) => ids.has(candidate.record.sessionId) && candidate.column !== "archived");
  if (cards.length === 0) {
    return;
  }
  const cardIds = cards.map((card) => card.record.sessionId);
  cleanup.setArchiving(cardIds, true);
  try {
    await archiveCards(sessions, cleanup, cards, ids);
  } finally {
    cleanup.setArchiving(cardIds, false);
  }
}

async function archiveCards(sessions: SessionStore, cleanup: ArchiveCleanupRegistry, cards: SessionCard[], ids: Set<string>): Promise<void> {
  const pluginItems = (await Promise.all(cards.map((card) => cleanup.collect(card)))).flat();
  const others = sessions.getCards().filter((other) => !ids.has(other.record.sessionId) && other.column !== "archived");
  const sharedWith = new Set(others.flatMap((other) => other.record.worktrees ?? []).map(pathKey));
  const worktrees = uniquePaths(cards.flatMap((card) => card.record.worktrees ?? [])).filter((folder) => !sharedWith.has(pathKey(folder)));
  const mayHaveStacks = cards.some((card) => card.record.composeStacks?.length || card.record.worktrees?.length);
  const distro = wslDistro();
  const stacks = (mayHaveStacks ? await composeProjects(distro) : []).filter(
    (project) => cards.some((card) => ownsProject(card.record, project)) && !others.some((other) => ownsProject(other.record, project))
  );
  const cleanupItems: CleanupItem[] = [
    ...pluginItems,
    ...stacks.map((project) => ({ label: `Remove Docker Compose project and its volumes: ${project.name} (${project.dir})`, run: () => removeComposeProject(project.name, distro) }))
  ];

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
    closeChats(cards);
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
  closeChats(cards);
  sessions.setArchivedMany(cards.map((card) => card.record.sessionId), true);
}

// Archiving closes the session's Argus chat and stops its process, before the slower cleanup runs.
function closeChats(cards: SessionCard[]): void {
  cards.forEach((card) => closeChatSession(card.record.sessionId));
}
