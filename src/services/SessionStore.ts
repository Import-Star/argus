import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { PrSummary, SessionBoardState, SessionCard, SessionColumn, SessionRecord } from "../types";
import { GhPrSyncService } from "./GhPrSyncService";
import { output } from "./log";
import { TranscriptIndex, TranscriptRef } from "./TranscriptIndex";
import { windowFilter } from "./windowScope";

const ARGUS_DIR = path.join(os.homedir(), ".claude", "argus");
const SESSIONS_DIR = path.join(ARGUS_DIR, "sessions");
const REGISTRY_DIR = path.join(os.homedir(), ".claude", "sessions");
const BOARD_STATE_FILE = path.join(ARGUS_DIR, "board.json");

interface RegistryEntry {
  pid: number;
  sessionId: string;
  name?: string;
  nameSource?: string;
  status?: string;
  statusUpdatedAt?: number;
}

export const COLUMN_ORDER: SessionColumn[] = ["needs-you", "working", "idle", "pr-open", "archived"];
export const COLUMN_LABEL: Record<SessionColumn, string> = {
  "needs-you": "Needs you",
  working: "Working",
  "pr-open": "PR open",
  idle: "Idle",
  archived: "Archived"
};

export class SessionStore implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<SessionCard[]>();
  public readonly onDidChange = this.emitter.event;
  private cards: SessionCard[] = [];
  private prByUrl = new Map<string, PrSummary>();
  public prsRefreshedAt?: number;
  private watchers: fs.FSWatcher[] = [];
  private debounce?: NodeJS.Timeout;
  private focusListener?: vscode.Disposable;
  private readonly scopeListeners: vscode.Disposable[] = [];
  private prTimer?: NodeJS.Timeout;
  private retentionTimer?: NodeJS.Timeout;
  private readonly transcripts = new TranscriptIndex();
  private usageScan?: Promise<void>;
  private usageRescan = false;

  public constructor(private readonly prSync: GhPrSyncService) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    for (const dir of [SESSIONS_DIR, REGISTRY_DIR]) {
      try {
        this.watchers.push(fs.watch(dir, () => this.scheduleRefresh()));
      } catch {
        // Directory missing until the first session runs; polling below covers it.
      }
    }
    this.prTimer = setInterval(() => void this.refreshPrs(), this.prRefreshMs());
    // Lookups fail while the laptop sleeps; refresh as soon as the user is back.
    this.focusListener = vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        void this.refreshPrs();
      }
    });
    // Each VS Code window only shows sessions for its own folders.
    this.scopeListeners.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("argus.sessions.scope")) {
          this.refresh();
        }
      })
    );
    this.cleanupOldSessions();
    this.retentionTimer = setInterval(() => this.cleanupOldSessions(), 3_600_000);
    void this.refreshPrs();
  }

  public getCards(): SessionCard[] {
    return this.cards;
  }

  public needsYou(): SessionCard[] {
    return this.cards.filter((card) => card.column === "needs-you");
  }

  public refresh(): void {
    const state = this.readBoardState();
    const registry = this.readRegistry();
    const records = this.readRecords();
    for (const record of records) {
      const entry = registry.get(record.sessionId);
      // A /rename name lives only in Claude Code's registry, which drops it when the session closes.
      const name = entry?.nameSource === "user" ? entry.name?.slice(0, 120) : undefined;
      if (name && name !== record.title) {
        record.title = name;
        this.saveTitle(record.sessionId, name);
      }
    }
    const inWindow = windowFilter();
    const now = Date.now();
    const staleMs = this.staleHours() * 3_600_000;

    this.cards = records
      .filter(inWindow)
      .map((record) => this.toCard(record, registry.get(record.sessionId), state, now, staleMs))
      .filter((card): card is SessionCard => card !== undefined)
      .sort((a, b) => {
        const byColumn = COLUMN_ORDER.indexOf(a.column) - COLUMN_ORDER.indexOf(b.column);
        return byColumn !== 0 ? byColumn : (b.record.lastMessageAt ?? b.record.startedAt) - (a.record.lastMessageAt ?? a.record.startedAt);
      });

    this.emitter.fire(this.cards);
    this.scanUsage();
  }

  // Every session in this window's scope, archived ones included.
  public async searchTranscripts(query: string): Promise<Map<string, string>> {
    return this.transcripts.search(transcriptRefs(this.cards), query);
  }

  // Reads new transcript lines for sessions not archived, then refreshes once if token use moved.
  private scanUsage(): void {
    if (this.usageScan) {
      this.usageRescan = true;
      return;
    }
    const refs = transcriptRefs(this.cards.filter((card) => card.column !== "archived"));
    this.usageScan = this.transcripts.update(refs).then((changed) => {
      this.usageScan = undefined;
      if (changed || this.usageRescan) {
        this.usageRescan = false;
        this.refresh();
      }
    });
  }

  public async refreshPrs(): Promise<void> {
    const urls = new Set<string>();
    for (const record of this.readRecords()) {
      for (const url of record.prs) {
        urls.add(url);
      }
    }
    if (urls.size > 0) {
      const fresh = await this.prSync.summarize([...urls], true);
      const failed: string[] = [];
      for (const url of urls) {
        const summary = fresh.get(url);
        if (summary && !summary.error) {
          this.prByUrl.set(url, summary);
        } else {
          failed.push(`${url}: ${summary?.error ?? "gh unavailable"}`);
          if (!this.prByUrl.has(url) && summary) {
            this.prByUrl.set(url, summary);
          }
        }
      }
      this.prsRefreshedAt = Date.now();
      if (failed.length > 0) {
        output.appendLine(`${new Date().toISOString()} PR lookup failed, kept last known state:\n  ${failed.join("\n  ")}`);
      }
    }
    this.refresh();
  }

  private saveTitle(sessionId: string, title: string): void {
    const file = path.join(SESSIONS_DIR, `${sessionId}.json`);
    try {
      const record = JSON.parse(fs.readFileSync(file, "utf8")) as SessionRecord;
      record.title = title;
      record.titleSource = "user";
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(record, null, 2));
      fs.renameSync(tmp, file);
    } catch (error) {
      output.appendLine(`Argus: could not save title for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public rename(sessionId: string, title: string): void {
    this.saveTitle(sessionId, title.slice(0, 120));
    this.refresh();
  }

  public markRead(sessionId: string): void {
    this.mutateBoardState((state) => {
      state.readAt[sessionId] = Date.now();
    });
  }

  public setArchived(sessionId: string, archived: boolean): void {
    this.mutateBoardState((state) => {
      if (archived) {
        state.archived[sessionId] = Date.now();
      } else {
        delete state.archived[sessionId];
        state.readAt[sessionId] = Date.now();
      }
    });
  }

  public dispose(): void {
    this.focusListener?.dispose();
    for (const listener of this.scopeListeners) {
      listener.dispose();
    }
    for (const watcher of this.watchers) {
      watcher.close();
    }
    if (this.debounce) {
      clearTimeout(this.debounce);
    }
    if (this.prTimer) {
      clearInterval(this.prTimer);
    }
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
    }
    this.emitter.dispose();
  }

  private toCard(
    record: SessionRecord,
    registry: RegistryEntry | undefined,
    state: SessionBoardState,
    now: number,
    staleMs: number
  ): SessionCard | undefined {
    const prs = record.prs.map((url) => this.prByUrl.get(url)).filter((pr): pr is PrSummary => Boolean(pr));
    const open = Boolean(registry);
    const read = (state.readAt[record.sessionId] ?? 0) >= record.stateSince;
    const archivedManually = state.archived[record.sessionId] !== undefined;
    const { repo, worktree } = describeCwd(record.cwd);
    const interrupted = isInterrupted(record, registry);
    const column = this.columnFor(record, registry, prs, read, archivedManually, interrupted, now, staleMs);
    if (!column) {
      return undefined;
    }

    return {
      record,
      repo,
      worktree,
      open,
      name: registry?.name,
      read,
      interrupted,
      archivedManually,
      prs,
      column,
      usage: record.transcriptPath ? this.transcripts.usage({ sessionId: record.sessionId, transcriptPath: record.transcriptPath }) : undefined
    };
  }

  private columnFor(
    record: SessionRecord,
    registry: RegistryEntry | undefined,
    prs: PrSummary[],
    read: boolean,
    archivedManually: boolean,
    interrupted: boolean,
    now: number,
    staleMs: number
  ): SessionColumn | undefined {
    const allPrsSettled = prs.length > 0 && prs.length === record.prs.length && prs.every((pr) => pr.state === "MERGED" || pr.state === "CLOSED");
    const anyPrOpen = prs.some((pr) => pr.state === "OPEN");
    const closed = !registry;
    const stale = closed && now - record.updatedAt > staleMs;

    if (closed && !record.lastPrompt && !record.title) {
      return undefined;
    }
    const busy = registry?.status === "busy" || (!closed && record.state === "working" && !interrupted);
    if (archivedManually || (!busy && (allPrsSettled || (stale && record.prs.length === 0)))) {
      return "archived";
    }
    if (interrupted || record.state === "permission" || record.state === "question") {
      return "needs-you";
    }
    // The main agent can Stop while background sub-agents keep the session busy, and Claude Code's own registry
    // stays "busy" throughout. Only call it done once the registry says the session is no longer busy.
    if (record.state === "done" && !read && registry?.status !== "busy") {
      return "needs-you";
    }
    if (registry?.status === "busy" || record.state === "working") {
      return "working";
    }
    if (anyPrOpen) {
      return "pr-open";
    }
    return "idle";
  }

  private readRecords(): SessionRecord[] {
    return readJsonDir<SessionRecord & { cardId?: string }>(SESSIONS_DIR)
      .filter((record) => typeof record.sessionId === "string")
      .map((record) => {
        // Legacy field from before plugin links existed.
        if (record.cardId && !record.links?.kanban) {
          record.links = { ...(record.links ?? {}), kanban: record.cardId };
        }
        delete record.cardId;
        return record;
      });
  }

  private retentionDays(): number {
    return Math.max(1, vscode.workspace.getConfiguration("argus").get<number>("sessions.retentionDays", 30));
  }

  // Deletes session record files for sessions that are not open (no live registry entry) once they have been
  // untouched for longer than argus.sessions.retentionDays. Runs at startup and hourly.
  private cleanupOldSessions(): void {
    const registry = this.readRegistry();
    const cutoff = Date.now() - this.retentionDays() * 86_400_000;
    let files: string[];
    try {
      files = fs.readdirSync(SESSIONS_DIR).filter((file) => file.endsWith(".json"));
    } catch {
      return;
    }
    for (const file of files) {
      const sessionId = file.replace(/\.json$/, "");
      if (registry.has(sessionId)) {
        continue;
      }
      const full = path.join(SESSIONS_DIR, file);
      try {
        const record = JSON.parse(fs.readFileSync(full, "utf8")) as SessionRecord;
        if (record.updatedAt < cutoff) {
          fs.rmSync(full, { force: true });
        }
      } catch {
        // Unreadable record; leave it rather than guess.
      }
    }
  }

  private readRegistry(): Map<string, RegistryEntry> {
    const map = new Map<string, RegistryEntry>();
    for (const entry of readJsonDir<RegistryEntry>(REGISTRY_DIR)) {
      if (entry.sessionId && isAlive(entry.pid)) {
        map.set(entry.sessionId, entry);
      }
    }
    return map;
  }

  private readBoardState(): SessionBoardState {
    try {
      const parsed = JSON.parse(fs.readFileSync(BOARD_STATE_FILE, "utf8")) as Partial<SessionBoardState>;
      return { archived: parsed.archived ?? {}, readAt: parsed.readAt ?? {} };
    } catch {
      return { archived: {}, readAt: {} };
    }
  }

  private mutateBoardState(mutator: (state: SessionBoardState) => void): void {
    const state = this.readBoardState();
    mutator(state);
    fs.mkdirSync(ARGUS_DIR, { recursive: true });
    fs.writeFileSync(BOARD_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
    this.refresh();
  }

  private scheduleRefresh(): void {
    if (this.debounce) {
      clearTimeout(this.debounce);
    }
    this.debounce = setTimeout(() => this.refresh(), 300);
  }

  private staleHours(): number {
    return vscode.workspace.getConfiguration("argus").get<number>("sessions.staleAfterHours", 24);
  }

  private prRefreshMs(): number {
    return Math.max(1, vscode.workspace.getConfiguration("argus").get<number>("sessions.prRefreshMinutes", 5)) * 60_000;
  }
}

function transcriptRefs(cards: SessionCard[]): TranscriptRef[] {
  return cards.flatMap((card) => (card.record.transcriptPath ? [{ sessionId: card.record.sessionId, transcriptPath: card.record.transcriptPath }] : []));
}

function readJsonDir<T>(dir: string): T[] {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((file) => file.endsWith(".json"));
  } catch {
    return [];
  }
  const items: T[] = [];
  for (const file of files) {
    try {
      items.push(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as T);
    } catch (error) {
      console.warn(`Argus: could not read ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return items;
}

// Claude Code fires no hook on Esc, so a turn that never reached Stop shows as "working" in our record. Once the
// registry has gone idle after our last update, or the process is gone, that turn was cut short.
function isInterrupted(record: SessionRecord, registry: RegistryEntry | undefined): boolean {
  if (record.state !== "working") {
    return false;
  }
  if (!registry) {
    return true;
  }
  return registry.status !== "busy" && (registry.statusUpdatedAt ?? 0) > record.updatedAt;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function describeCwd(cwd: string): { repo: string; worktree?: string } {
  const parts = cwd.split(path.sep).filter(Boolean);
  const worktreeIndex = parts.findIndex((part) => part === ".claude" || part === "worktrees" || part === ".worktrees");
  if (worktreeIndex > 0 && worktreeIndex < parts.length - 1) {
    return { repo: parts[worktreeIndex - 1], worktree: parts[parts.length - 1] };
  }
  return { repo: parts[parts.length - 1] ?? cwd };
}

export function formatElapsed(sinceMs: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - sinceMs) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${Math.floor(hours / 24)}d`;
}

export async function renameSessionPrompt(store: SessionStore, sessionId: string): Promise<void> {
  const card = store.getCards().find((candidate) => candidate.record.sessionId === sessionId);
  if (!card) {
    return;
  }
  const title = await vscode.window.showInputBox({
    title: "Rename chat",
    value: card.record.title ?? "",
    validateInput: (value) => (value.trim() ? undefined : "Title is required")
  });
  if (title !== undefined) {
    store.rename(sessionId, title.trim());
  }
}
