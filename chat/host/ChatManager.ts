import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import type { ChatDeps, ChatExtensionHub } from "../../src/chat/types";
import type { LiveChat } from "../../src/services/sessionColumn";
import { MULTI_AGENT_SETTING, multiAgentEnabled } from "../../src/chat/multiAgent";
import { membersOf } from "../../src/services/sessionGroups";
import type { CardInfo, ChatGroup, ChatStatus, EffortLevel, PermissionDecision, PermissionMode, PermissionRequest, RailSession } from "../../src/chat/protocol";
import { findClaude } from "../../src/services/claudeCli";
import { configuredClaude, promptMissingClaude } from "../../src/services/claudeSetup";
import { BranchCache } from "./branchCache";
import { ChatPanel } from "./ChatPanel";
import { hasTranscript, readPanelState } from "./restore";
import { ChatSession } from "./ChatSession";
import { forkTranscript } from "./history";
import { SavedTab, tabsToSave, unrestored } from "./savedTabs";

interface Remembered {
  model?: string;
  effort?: EffortLevel;
  permissionMode?: PermissionMode;
  textOnly?: boolean;
  chrome?: boolean;
}

const SESSION_CHOICES_KEY = "argus.chat.sessionChoices";
const SESSION_CWDS_KEY = "argus.chat.sessionCwds";
const SAVED_TABS_KEY = "argus.chat.savedTabs";
const FOCUS_GROUP = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth"].map((nth) => `workbench.action.focus${nth}EditorGroup`);

function gitBranch(folder: string): string | undefined {
  try {
    return execFileSync("git", ["-C", folder, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export class ChatManager implements vscode.Disposable {
  private readonly branches = new BranchCache(gitBranch);
  private readonly sessions = new Map<string, ChatSession>();
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly panels = new Set<ChatPanel>();
  // Where the board's "add to grid" goes when no grid tab asked: the grid focused last.
  private lastGrid?: ChatPanel;
  private lastGroups = "";
  private readonly pendingEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChangePending = this.pendingEmitter.event;
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly log: vscode.OutputChannel;
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;

  public get extensions(): ChatExtensionHub {
    return this.deps.chatExtensions;
  }
  private savedTabs: SavedTab[];
  private closing = false;

  constructor(private readonly context: vscode.ExtensionContext, private readonly deps: ChatDeps) {
    this.log = vscode.window.createOutputChannel("Argus Chat");
    this.savedTabs = context.workspaceState.get<SavedTab[]>(SAVED_TABS_KEY, []);
    this.subscriptions.push(
      vscode.window.tabGroups.onDidChangeTabs(() => this.saveTabs()),
      this.log,
      deps.onDidChangeCards(() => this.broadcastCards()),
      deps.onDidChangePluginSections(() => this.broadcastCards()),
      deps.chatExtensions.onDidChange(() => this.reloadPanels()),
      deps.chatExtensions.onDidPost((id, message) => this.panels.forEach((panel) => panel.post({ type: "extension", id, message }))),
      vscode.window.registerWebviewPanelSerializer("argusChat", { deserializeWebviewPanel: (panel, state) => this.restore(panel, "single", state) }),
      vscode.window.registerWebviewPanelSerializer("argusChatGrid", { deserializeWebviewPanel: (panel, state) => this.restore(panel, "grid", state) }),
      vscode.workspace.onDidChangeConfiguration((event) => event.affectsConfiguration(MULTI_AGENT_SETTING) && this.panels.forEach((panel) => panel.sendLayout()))
    );
    deps.setLiveChats(() => this.liveChats());
  }

  private liveChats(): LiveChat[] {
    return [...this.sessions.values()]
      .filter((session) => session.meta.status !== "ended" && session.meta.status !== "error")
      .map((session) => ({ sessionId: session.sessionId, busy: session.meta.status === "working" || session.meta.status === "needs-you", since: session.meta.statusSince, startedAt: session.processStartedAt }));
  }

  // Archiving a chat closes its tab and stops its process.
  public closeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    for (const panel of [...this.panels]) {
      if (panel.view === "single" && panel.sessionIds[0] === sessionId) {
        panel.dispose();
      } else if (panel.sessionIds.includes(sessionId)) {
        void panel.setSessions(panel.sessionIds.filter((id) => id !== sessionId), panel.groupId);
      }
    }
    if (this.sessions.get(sessionId) === session) {
      session.dispose();
      this.sessions.delete(sessionId);
      this.deps.setLiveChats(() => this.liveChats());
    }
    return true;
  }

  private async restore(panel: vscode.WebviewPanel, view: "single" | "grid", raw: unknown): Promise<void> {
    const state = readPanelState(raw);
    const ids: string[] = [];
    for (const id of state?.sessionIds ?? []) {
      if (this.sessions.has(id) || this.revive(id)) {
        ids.push(id);
      }
    }
    // A tab that became a grid keeps its original view type, so trust the saved layout over it.
    const layout = state?.view ?? view;
    if (ids.length === 0 || (layout === "grid" && !multiAgentEnabled())) {
      panel.dispose();
      return;
    }
    // Opened again before this tab was restored: keep the tab the user just clicked. Track it first so closing the
    // other one doesn't count the chat as unused and stop it.
    const duplicate = layout === "single" ? this.singlePanel(ids[0]) : undefined;
    this.track(new ChatPanel(this, this.context.extensionUri, layout, ids, undefined, state?.groupId, panel));
    duplicate?.dispose();
  }

  private singlePanel(sessionId: string): ChatPanel | undefined {
    return [...this.panels].find((panel) => panel.view === "single" && panel.sessionIds[0] === sessionId);
  }

  // VS Code restores a chat tab only when it's first shown, so until then Argus finds it by its saved label.
  private unrestoredTabs(): vscode.Tab[] {
    const isChat = (viewType: string) => viewType.endsWith("argusChat");
    const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs.filter((tab) => tab.input instanceof vscode.TabInputWebview && isChat(tab.input.viewType)));
    return unrestored(tabs, [...this.panels].filter((panel) => isChat(panel.viewType)).map((panel) => panel.tabTitle));
  }

  private saveTabs(): void {
    if (this.closing) {
      return;
    }
    const live = [...this.panels].filter((panel) => panel.view === "single").map((panel) => ({ sessionId: panel.sessionIds[0], title: panel.tabTitle }));
    const next = tabsToSave(this.savedTabs, live, this.unrestoredTabs().map((tab) => tab.label));
    // Tab events fire on every focus change, so only write when the list actually changed.
    if (JSON.stringify(next) === JSON.stringify(this.savedTabs)) {
      return;
    }
    this.savedTabs = next;
    void this.context.workspaceState.update(SAVED_TABS_KEY, this.savedTabs);
  }

  // Shows the chat's tab from before the restart, if it's still open, and waits for VS Code to restore it.
  private async revealSavedTab(sessionId: string): Promise<boolean> {
    const saved = this.savedTabs.find((tab) => tab.sessionId === sessionId);
    const tab = saved && this.unrestoredTabs().find((entry) => entry.label === saved.title);
    const focusGroup = tab && FOCUS_GROUP[tab.group.viewColumn - 1];
    if (!tab || !focusGroup) {
      return false;
    }
    try {
      await vscode.commands.executeCommand(focusGroup);
      await vscode.commands.executeCommand("workbench.action.openEditorAtIndex", tab.group.tabs.indexOf(tab));
    } catch (error) {
      this.log.appendLine(`reveal saved tab: ${error}`);
      return false;
    }
    for (let waited = 0; waited < 3000; waited += 50) {
      if (this.singlePanel(sessionId)) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }

  private revive(sessionId: string): ChatSession | undefined {
    const card = this.deps.getCards().find((entry) => entry.record.sessionId === sessionId);
    const cwd = card?.record.cwd ?? this.context.globalState.get<Record<string, string>>(SESSION_CWDS_KEY)?.[sessionId];
    if (!cwd) {
      return undefined;
    }
    return this.add(new ChatSession({ sessionId, cwd, resume: hasTranscript(sessionId), ...this.defaults(cwd, sessionId), title: card?.record.title }));
  }

  public session(sessionId: string): ChatSession | undefined {
    return this.sessions.get(sessionId);
  }

  // Same path as archiving the board card: confirmation, worktree and plugin cleanup, then the chat closes.
  // Same prompt as renaming the board card; the title sync then updates this tab.
  public async rename(sessionId: string): Promise<void> {
    if (!this.deps.getCards().some((card) => card.record.sessionId === sessionId)) {
      void vscode.window.showInformationMessage("Argus: send this chat its first message before renaming it.");
      return;
    }
    await this.deps.rename(sessionId);
  }

  public archive(sessionId: string): Promise<void> {
    return this.deps.archive(sessionId);
  }

  // True while the chat is on screen in front of the user: its tab is active in the focused window.
  public isViewing(sessionId: string): boolean {
    return vscode.window.state.focused && [...this.panels].some((panel) => panel.active && panel.sessionIds.includes(sessionId));
  }

  public isChatSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  public pendingFor(sessionId: string): PermissionRequest[] {
    return this.sessions.get(sessionId)?.pendingRequests() ?? [];
  }

  public respond(sessionId: string, id: string, decision: PermissionDecision): void {
    this.sessions.get(sessionId)?.respond(id, decision);
  }

  public send(sessionId: string, text: string): void {
    this.sessions.get(sessionId)?.send(text);
  }

  public remember(sessionId: string, choice: Remembered): void {
    if (choice.model) {
      writeUserSettings((settings) => {
        if (choice.model === "default") {
          delete settings.model;
        } else {
          settings.model = choice.model;
        }
      }, (line) => this.log.appendLine(line));
    }
    if (choice.permissionMode) {
      writeUserSettings((settings) => {
        settings.permissions = { ...(settings.permissions as Record<string, unknown> | undefined), defaultMode: choice.permissionMode };
      }, (line) => this.log.appendLine(line));
    }
    if (choice.effort) {
      void this.sessions.get(sessionId)?.saveEffortDefault(choice.effort).catch((error) => this.log.appendLine(`save effort: ${error}`));
    }
    const all = this.context.globalState.get<Record<string, Remembered>>(SESSION_CHOICES_KEY) ?? {};
    void this.context.globalState.update(SESSION_CHOICES_KEY, { ...all, [sessionId]: { ...all[sessionId], ...choice } });
  }

  // Opens a session in its own tab: an existing chat, a board session resumed here, or a new chat when no id is given.
  public async open(sessionId?: string, prompt?: string, column?: vscode.ViewColumn): Promise<void> {
    const session = sessionId ? await this.resume(sessionId) : await this.create();
    if (!session) {
      return;
    }
    this.deps.markRead(session.sessionId);
    const existing = this.singlePanel(session.sessionId);
    if (existing) {
      existing.reveal();
    } else if (!(await this.revealSavedTab(session.sessionId))) {
      this.track(new ChatPanel(this, this.context.extensionUri, "single", [session.sessionId], column));
    }
    if (prompt) {
      session.send(prompt);
    }
  }

  public async review(sessionId: string, target: { worktree?: string; prUrl?: string }): Promise<void> {
    await this.open(sessionId);
    const panel = [...this.panels].find((entry) => entry.sessionIds.includes(sessionId));
    await panel?.whenReady;
    panel?.post({ type: "openReview", sessionId, scope: target.prUrl ? "pr" : "base", ...target });
  }

  public openGrid(sessionIds?: string[], groupId?: string): void {
    if (multiAgentEnabled()) {
      void this.showGrid(sessionIds, groupId);
    }
  }

  public openGroup(sessionId: string): void {
    if (!multiAgentEnabled()) {
      return;
    }
    const ids = this.memberIds(sessionId);
    this.openGrid(ids, this.deps.getGroupOf()[sessionId] ?? ids[0]);
  }

  // The new agent starts in the same folder; an empty first message just opens it.
  public async addAgent(fromSessionId: string): Promise<void> {
    const from = this.sessions.get(fromSessionId);
    if (!from || !multiAgentEnabled()) {
      return;
    }
    const session = this.spawn(from.meta.cwd);
    this.deps.addToGroup(session.sessionId, fromSessionId);
    await this.showGroupFrom(fromSessionId);
  }

  // Reuse the tab the agent was added from: a single chat becomes the grid, an open grid gets the new member.
  private async showGroupFrom(fromSessionId: string): Promise<void> {
    const ids = this.memberIds(fromSessionId);
    const groupId = this.deps.getGroupOf()[fromSessionId];
    const single = [...this.panels].find((panel) => panel.view === "single" && panel.sessionIds[0] === fromSessionId);
    const grid = [...this.panels].find((panel) => panel.view === "grid" && panel.sessionIds.includes(fromSessionId));
    const host = grid ?? single;
    if (!host) {
      await this.showGrid(ids, groupId);
      return;
    }
    for (const id of ids) {
      await this.resume(id);
    }
    if (host.view === "single") {
      await host.setView("grid", ids, groupId);
    } else {
      await host.setSessions(ids, groupId);
    }
    host.reveal();
  }

  // The fork joins the source's group and opens the grid; `draft` lands in its composer.
  public async forkAgent(fromSessionId: string, messageId: string, before: boolean, draft?: string): Promise<void> {
    const from = this.sessions.get(fromSessionId);
    if (!from) {
      return;
    }
    const sessionId = await forkTranscript(from, messageId, before);
    const session = this.add(new ChatSession({ sessionId, cwd: from.meta.cwd, resume: true, ...this.defaults(from.meta.cwd, fromSessionId), title: from.meta.title && `${from.meta.title} (fork)` }));
    if (multiAgentEnabled()) {
      this.deps.addToGroup(session.sessionId, fromSessionId);
      await this.showGroupFrom(fromSessionId);
    } else {
      await this.open(session.sessionId);
    }
    if (draft) {
      session.fillComposer(draft);
    }
  }

  public groups(): ChatGroup[] {
    const groupOf = this.deps.getGroupOf();
    const cards = new Map(this.deps.getCards().map((card) => [card.record.sessionId, card]));
    return [...new Set(Object.values(groupOf))].flatMap((id) => {
      const members = membersOf(groupOf, id)
        .filter((sessionId) => this.sessions.has(sessionId) || cards.has(sessionId))
        .map((sessionId) => {
          const card = cards.get(sessionId);
          const meta = this.sessions.get(sessionId)?.meta;
          return {
            sessionId,
            title: meta?.title || card?.record.title || "New chat",
            status: meta?.status ?? (card ? statusOf(card.column) : "idle")
          };
        });
      return members.length >= 2 ? [{ id, title: members[0].title, members }] : [];
    });
  }

  private memberIds(sessionId: string): string[] {
    const known = new Set([...this.sessions.keys(), ...this.deps.getCards().map((card) => card.record.sessionId)]);
    return membersOf(this.deps.getGroupOf(), sessionId).filter((id) => known.has(id));
  }

  private grids(): ChatPanel[] {
    return [...this.panels].filter((panel) => panel.view === "grid");
  }

  // Each group gets its own tab; chats picked by hand share the one grid without a group.
  private async showGrid(sessionIds?: string[], groupId?: string): Promise<void> {
    const ids: string[] = [];
    for (const id of sessionIds ?? [...this.sessions.keys()]) {
      if (await this.resume(id)) {
        ids.push(id);
        this.deps.markRead(id);
      }
    }
    const existing = this.grids().find((panel) => panel.groupId === groupId);
    if (existing) {
      existing.reveal();
      await existing.setSessions(ids, groupId);
      return;
    }
    await this.track(new ChatPanel(this, this.context.extensionUri, "grid", ids, undefined, groupId)).whenReady;
  }

  // `from` is the grid tab that asked; the board's "add to grid" has none.
  public gridAction(action: "add" | "remove" | "expand", sessionId: string, from?: ChatPanel): void {
    if (action === "expand") {
      void this.open(sessionId);
      return;
    }
    if (action === "add" && !multiAgentEnabled()) {
      return;
    }
    const last = this.lastGrid?.view === "grid" ? this.lastGrid : undefined;
    const target = from ?? last ?? this.grids().find((panel) => !panel.groupId);
    if (!target) {
      this.openGrid([sessionId]);
      return;
    }
    const current = target.sessionIds;
    const groupId = target.groupId;
    if (action === "remove") {
      void this.popOut(target, sessionId);
      return;
    }
    void (async () => {
      await this.resume(sessionId);
      const member = groupId && current.find((id) => this.deps.getGroupOf()[id] === groupId);
      if (member) {
        this.deps.addToGroup(sessionId, member);
      }
      target.reveal();
      await target.setSessions([...new Set([...current, sessionId])], groupId);
    })();
  }

  // The removed chat leaves its group and gets its own tab; a lone chat left behind turns the grid back into its single tab.
  private async popOut(grid: ChatPanel, sessionId: string): Promise<void> {
    const remaining = grid.sessionIds.filter((id) => id !== sessionId);
    const groupOf = this.deps.getGroupOf();
    if (grid.groupId && groupOf[sessionId] === grid.groupId) {
      this.deps.removeFromGroup(sessionId);
      if (remaining.length === 1) {
        this.deps.removeFromGroup(remaining[0]);
      }
    }
    if (remaining.length === 0) {
      await grid.setView("single", [sessionId]);
      return;
    }
    // Open first: closing the grid stops chats no tab shows, which would include this one.
    await this.open(sessionId);
    const single = remaining.length === 1 && [...this.panels].find((panel) => panel.view === "single" && panel.sessionIds[0] === remaining[0]);
    if (single) {
      grid.dispose();
    } else {
      const groupId = remaining.length > 1 ? this.deps.getGroupOf()[remaining[0]] : undefined;
      await grid.setView(remaining.length > 1 ? "grid" : "single", remaining, groupId);
    }
  }

  public rail(): RailSession[] {
    return this.deps
      .getCards()
      .filter((card) => card.column !== "archived")
      .map((card) => ({
        sessionId: card.record.sessionId,
        title: card.record.title || card.record.lastPrompt || "Untitled chat",
        column: card.column,
        activity: card.record.pending || card.record.lastTool,
        since: card.record.stateSince,
        repo: card.repo
      }));
  }

  private worktreesOf(record: { cwd: string; worktrees?: string[] }, cwdWorktree?: string): CardInfo["worktrees"] {
    const paths = [...(cwdWorktree ? [record.cwd] : []), ...(record.worktrees ?? [])];
    return [...new Set(paths)].map((folder) => ({ name: path.basename(folder), path: folder, branch: this.branches.get(folder) }));
  }

  public worktreePath(sessionId: string, folder?: string): string | undefined {
    return folder ? this.card(sessionId)?.worktrees.find((entry) => entry.path === folder)?.path : undefined;
  }

  public pluginAction(sessionId: string, key: string, itemId: string, value?: string): Promise<void> {
    return this.deps.pluginAction(sessionId, key, itemId, value);
  }

  public sideQuestionDefaults(cwd: string): { claudePath?: string; additionalDirectories: string[]; log(line: string): void } {
    const { claudePath, additionalDirectories, log } = this.defaults(cwd);
    return { claudePath, additionalDirectories, log };
  }

  public card(sessionId: string): CardInfo | undefined {
    const card = this.deps.getCards().find((entry) => entry.record.sessionId === sessionId);
    if (!card) {
      return undefined;
    }
    return {
      sessionId,
      worktree: card.worktree,
      worktrees: this.worktreesOf(card.record, card.worktree),
      prs: card.prs.map((pr) => ({
        key: pr.key,
        title: pr.title,
        url: pr.url,
        state: pr.state,
        isDraft: pr.isDraft,
        reviewDecision: pr.reviewDecision,
        checks: pr.checks
      })),
      usedTokens: card.usage?.usedTokens,
      compactions: card.usage?.compactions,
      plugins: this.deps.pluginSections(card)
    };
  }

  public async findFiles(cwd: string, query: string): Promise<string[]> {
    const base = vscode.Uri.file(cwd);
    const pattern = new vscode.RelativePattern(base, `**/*${query.replace(/[\\[\]{}*?]/g, "")}*`);
    const files = await vscode.workspace.findFiles(pattern, "**/{node_modules,.git,out,dist}/**", 30);
    return files.map((file) => path.relative(cwd, file.fsPath));
  }

  // Plugins register and dispose chat extensions in bursts (startup, Reload Plugins): reload each tab once per burst.
  private reloadPanels(): void {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => this.panels.forEach((panel) => panel.reload()), 100);
  }

  public dispose(): void {
    clearTimeout(this.reloadTimer);
    this.closing = true;
    this.idleTimers.forEach((timer) => clearTimeout(timer));
    this.panels.forEach((panel) => panel.dispose());
    this.sessions.forEach((session) => session.dispose());
    this.sessions.clear();
    this.deps.setLiveChats(undefined);
    this.subscriptions.forEach((item) => item.dispose());
    this.pendingEmitter.dispose();
  }

  private track(panel: ChatPanel): ChatPanel {
    this.panels.add(panel);
    panel.onDidFocus(() => {
      panel.sessionIds.forEach((id) => this.deps.markRead(id));
      if (panel.view === "grid") {
        this.lastGrid = panel;
      }
    });
    panel.onDidDispose(() => {
      this.panels.delete(panel);
      if (this.lastGrid === panel) {
        this.lastGrid = undefined;
      }
      this.closeUnused();
    });
    return panel;
  }

  // A session with no panel left keeps running in the background until it has been idle for backgroundIdleMinutes.
  private closeUnused(): void {
    const idleMs = vscode.workspace.getConfiguration("argus.chat").get<number>("backgroundIdleMinutes", 60) * 60_000;
    for (const [id, session] of this.sessions) {
      clearTimeout(this.idleTimers.get(id));
      this.idleTimers.delete(id);
      const shown = [...this.panels].some((panel) => panel.sessionIds.includes(id));
      if (shown || !session.stoppable) {
        continue;
      }
      const left = session.meta.statusSince + idleMs - Date.now();
      if (left > 0) {
        this.idleTimers.set(id, setTimeout(() => this.closeUnused(), left));
        continue;
      }
      session.dispose();
      this.sessions.delete(id);
      this.deps.setLiveChats(() => this.liveChats());
    }
  }

  private spawn(cwd: string): ChatSession {
    return this.add(new ChatSession({ cwd, resume: false, ...this.defaults(cwd) }));
  }

  // The SDK's own binary package isn't shipped in the VSIX, so chat needs the user's Claude Code install.
  private claudeReady(): boolean {
    if (configuredClaude()) {
      return true;
    }
    void promptMissingClaude();
    return false;
  }

  private async create(): Promise<ChatSession | undefined> {
    if (!this.claudeReady()) {
      return undefined;
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    const ask = folders.length > 1 && vscode.workspace.getConfiguration("argus.chat").get<boolean>("askForFolder", false);
    const folder = ask ? await vscode.window.showWorkspaceFolderPick({ placeHolder: "Start the chat in which folder?" }) : folders[0];
    // Dismissing the folder pick cancels; falling back to home would hide the chat from this window's board.
    if (ask && !folder) {
      return undefined;
    }
    return this.spawn(folder?.uri.fsPath ?? os.homedir());
  }

  private async resume(sessionId: string): Promise<ChatSession | undefined> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }
    if (!this.claudeReady()) {
      return undefined;
    }
    const card = this.deps.getCards().find((entry) => entry.record.sessionId === sessionId);
    if (!card) {
      void vscode.window.showWarningMessage(`Argus: no session ${sessionId} on the board.`);
      return undefined;
    }
    if (card.open) {
      const choice = await vscode.window.showWarningMessage(
        "This session is running in another Claude Code process, such as a terminal. Opening it here as well means two Claude processes write to the same transcript.",
        { modal: true },
        "Open Anyway"
      );
      if (!choice) {
        return undefined;
      }
    }
    return this.add(
      new ChatSession({
        sessionId,
        cwd: card.record.cwd,
        resume: true,
        ...this.defaults(card.record.cwd, sessionId),
        title: card.record.title
      })
    );
  }

  private add(session: ChatSession): ChatSession {
    this.sessions.set(session.sessionId, session);
    const cwds = this.context.globalState.get<Record<string, string>>(SESSION_CWDS_KEY) ?? {};
    void this.context.globalState.update(SESSION_CWDS_KEY, { ...cwds, [session.sessionId]: session.meta.cwd });
    // Without its own entry a reopened chat follows settings.json, which a pick in any chat changes.
    const { model, effort, permissionMode } = session.meta;
    const choices = this.context.globalState.get<Record<string, Remembered>>(SESSION_CHOICES_KEY) ?? {};
    const started: Remembered = { ...(model !== "default" && { model }), ...(effort && { effort }), ...(permissionMode && { permissionMode }) };
    void this.context.globalState.update(SESSION_CHOICES_KEY, { ...choices, [session.sessionId]: { ...started, ...choices[session.sessionId] } });
    let status = session.meta.status;
    session.onMessage((message) => {
      if (message.type === "meta" && message.meta.status !== status) {
        status = message.meta.status;
        this.deps.setLiveChats(() => this.liveChats());
      }
      // Checked at turn end, not when background tasks hit zero: the CLI then runs a turn to report their results.
      if ((message.type === "sdk" && message.message.type === "result") || (message.type === "meta" && (status === "ended" || status === "error"))) {
        queueMicrotask(() => this.closeUnused());
      }
      if (message.type === "permission" || message.type === "permissionResolved") {
        this.pendingEmitter.fire();
      }
      if (message.type === "meta") {
        this.broadcastGroups();
      }
    });
    session.start();
    this.deps.setLiveChats(() => this.liveChats());
    return session;
  }

  // A resumed chat keeps its own last model/effort; without one, the CLI restores the model from the transcript.
  // New chats follow Claude Code's own settings; a reopened chat keeps the model/effort last picked in it.
  private defaults(cwd: string, resumeId?: string): { claudePath?: string; additionalDirectories: string[]; model?: string; effort?: EffortLevel; permissionMode: PermissionMode; textOnly: boolean; chrome?: boolean; remoteControlAtStartup?: boolean; log(line: string): void } {
    const config = vscode.workspace.getConfiguration("argus.chat");
    const claude = readClaudeSettings(cwd);
    const remembered = (resumeId && this.context.globalState.get<Record<string, Remembered>>(SESSION_CHOICES_KEY)?.[resumeId]) || {};
    return {
      claudePath: findClaude(config.get<string>("claudePath", "")),
      additionalDirectories: (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
      model: remembered.model ?? claude.model,
      effort: remembered.effort ?? claude.effort,
      permissionMode: remembered.permissionMode ?? claude.permissionMode ?? "default",
      textOnly: remembered.textOnly ?? config.get<boolean>("textOnlyDefault", false),
      // SDK sessions ignore Claude Code's own "/chrome → Enabled by default", so Argus applies it.
      chrome: remembered.chrome ?? (chromeDefaultEnabled() || undefined),
      remoteControlAtStartup: claude.remoteControlAtStartup,
      log: (line) => this.log.appendLine(line)
    };
  }

  private broadcastGroups(): void {
    const groups = this.groups();
    const json = JSON.stringify(groups);
    if (json !== this.lastGroups) {
      this.lastGroups = json;
      this.panels.forEach((panel) => panel.post({ type: "groups", groups }));
    }
  }

  private broadcastCards(): void {
    this.broadcastGroups();
    for (const [id, session] of this.sessions) {
      const card = this.deps.getCards().find((entry) => entry.record.sessionId === id);
      const title = card && (card.record.title || card.record.lastPrompt);
      if (title && title !== session.meta.title) {
        session.rename(title);
      }
      const name = (card?.record.titled || card?.record.titleSource === "user") && card.record.title?.replace(/\s+/g, " ").trim();
      if (name && card?.name && card.name !== name) {
        session.syncName(name);
      }
    }
    const rail = this.rail();
    for (const panel of this.panels) {
      panel.post({ type: "rail", sessions: rail });
      for (const id of panel.sessionIds) {
        const card = this.card(id);
        if (card) {
          panel.post({ type: "card", card });
        }
      }
    }
  }
}

function statusOf(column: string): ChatStatus {
  return column === "needs-you" ? "needs-you" : column === "working" ? "working" : column === "archived" ? "ended" : "idle";
}

// Same precedence as Claude Code: user, then project, then local project settings.
function readClaudeSettings(cwd: string): { model?: string; effort?: EffortLevel; permissionMode?: PermissionMode; remoteControlAtStartup?: boolean } {
  const files = [path.join(os.homedir(), ".claude", "settings.json"), path.join(cwd, ".claude", "settings.json"), path.join(cwd, ".claude", "settings.local.json")];
  const merged: { model?: string; effort?: EffortLevel; permissionMode?: PermissionMode; remoteControlAtStartup?: boolean } = {};
  for (const file of files) {
    try {
      const settings = JSON.parse(fs.readFileSync(file, "utf8")) as { model?: string; effortLevel?: EffortLevel; permissions?: { defaultMode?: PermissionMode }; remoteControlAtStartup?: boolean };
      merged.remoteControlAtStartup = typeof settings.remoteControlAtStartup === "boolean" ? settings.remoteControlAtStartup : merged.remoteControlAtStartup;
      merged.model = settings.model ?? merged.model;
      merged.effort = settings.effortLevel ?? merged.effort;
      merged.permissionMode = settings.permissions?.defaultMode ?? merged.permissionMode;
    } catch {
      // Missing or unreadable settings file: Claude Code skips it too.
    }
  }
  return merged;
}

// Claude Code keeps "/chrome → Enabled by default" in its global config, ~/.claude.json. Only that one key is read.
function chromeDefaultEnabled(): boolean {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude.json"), "utf8")) as { claudeInChromeDefaultEnabled?: unknown };
    return config.claudeInChromeDefaultEnabled === true;
  } catch {
    return false;
  }
}

// The CLI's settings writer only accepts effortLevel, so model and default mode are written directly, keeping every other key.
function writeUserSettings(change: (settings: Record<string, unknown>) => void, log: (line: string) => void): void {
  const file = path.join(os.homedir(), ".claude", "settings.json");
  try {
    const settings = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>) : {};
    change(settings);
    fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  } catch (error) {
    log(`save settings: ${error instanceof Error ? error.message : String(error)}`);
  }
}
