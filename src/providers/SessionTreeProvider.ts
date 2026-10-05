import * as path from "path";
import * as vscode from "vscode";
import { COLUMN_LABEL, COLUMN_ORDER, formatElapsed, SessionStore } from "../services/SessionStore";
import { SessionCard, SessionColumn } from "../types";

type Node = { kind: "group"; column: SessionColumn } | { kind: "session"; card: SessionCard } | { kind: "worktree"; folder: string };

const ICON: Record<SessionColumn, vscode.ThemeIcon> = {
  "needs-you": new vscode.ThemeIcon("bell-dot", new vscode.ThemeColor("notificationsWarningIcon.foreground")),
  working: new vscode.ThemeIcon("sync~spin", new vscode.ThemeColor("charts.blue")),
  "pr-open": new vscode.ThemeIcon("git-pull-request", new vscode.ThemeColor("charts.green")),
  idle: new vscode.ThemeIcon("circle-outline"),
  archived: new vscode.ThemeIcon("archive")
};

export class SessionTreeProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  public readonly onDidChangeTreeData = this.emitter.event;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly tick: NodeJS.Timeout;
  private view?: vscode.TreeView<Node>;

  public constructor(private readonly store: SessionStore) {
    this.disposables.push(store.onDidChange(() => this.render()));
    this.tick = setInterval(() => this.emitter.fire(undefined), 30_000);
  }

  public attach(view: vscode.TreeView<Node>): void {
    this.view = view;
    this.render();
  }

  public getChildren(element?: Node): Node[] {
    const cards = this.store.getCards();
    if (!element) {
      return COLUMN_ORDER.filter((column) => cards.some((card) => card.column === column)).map((column) => ({ kind: "group", column }));
    }
    if (element.kind === "group") {
      return cards.filter((card) => card.column === element.column).map((card) => ({ kind: "session", card }));
    }
    if (element.kind === "session") {
      return (element.card.record.worktrees ?? []).map((folder) => ({ kind: "worktree", folder }));
    }
    return [];
  }

  public getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "group") {
      const count = this.store.getCards().filter((card) => card.column === node.column).length;
      const item = new vscode.TreeItem(
        COLUMN_LABEL[node.column],
        node.column === "archived" ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded
      );
      item.description = String(count);
      item.iconPath = ICON[node.column];
      item.contextValue = "group";
      return item;
    }

    if (node.kind === "worktree") {
      const item = new vscode.TreeItem(path.basename(node.folder));
      item.description = "open worktree";
      item.tooltip = node.folder;
      item.iconPath = new vscode.ThemeIcon("repo");
      item.contextValue = "worktree";
      item.command = { command: "argus.sessions.openWorktree", title: "Open Worktree", arguments: [node] };
      return item;
    }

    const { card } = node;
    const { record } = card;
    const item = new vscode.TreeItem(
      record.title ?? "New chat",
      record.worktrees?.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None
    );
    const where = card.worktree ? `${card.repo}/${card.worktree}` : card.repo;
    item.description = `${where}${card.name && card.name !== record.title ? ` · ${card.name}` : ""} · ${stateLabel(card)} ${formatElapsed(record.stateSince)}`;
    item.iconPath = ICON[card.column];
    item.tooltip = tooltipFor(card);
    item.contextValue = ["session", card.column === "archived" ? "archived" : "active", card.column === "needs-you" && record.state === "done" ? "unread" : ""].join(" ");
    item.command = { command: "argus.sessions.open", title: "Open Session Tab", arguments: [node] };
    return item;
  }

  public dispose(): void {
    clearInterval(this.tick);
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.emitter.dispose();
  }

  private render(): void {
    const count = this.store.needsYou().length;
    if (this.view) {
      this.view.badge = count > 0 ? { value: count, tooltip: `${count} session(s) need you` } : undefined;
    }
    this.emitter.fire(undefined);
  }
}

export function stateLabel(card: SessionCard): string {
  if (card.interrupted) {
    return "interrupted";
  }
  if (card.column === "working") {
    return "working";
  }
  switch (card.record.state) {
    case "permission":
      return "permission";
    case "question":
      return "question";
    case "done":
      return card.read ? "idle" : "finished";
    case "working":
      return "working";
    case "ended":
      return "closed";
    default:
      return card.open ? "idle" : "closed";
  }
}

// Session-supplied text (title, cwd, pending tool, last message) is untrusted and must never be interpreted as
// markdown: it is appended with appendText, which escapes it. Only the PR links below, built entirely from our
// own data, use appendMarkdown.
function tooltipFor(card: SessionCard): vscode.MarkdownString {
  const { record } = card;
  const md = new vscode.MarkdownString();
  md.appendText(`${record.title ?? "New chat"}\n\n`);
  md.appendText(`${record.cwd}\n\n`);
  if (record.pending) {
    md.appendText(`Waiting on: ${record.pending}\n\n`);
  }
  if (record.lastMessage) {
    md.appendText(`Last: ${record.lastMessage}\n\n`);
  }
  const agents = card.open ? Object.values(record.subagents ?? {}) : [];
  if (agents.length > 0) {
    md.appendText(`Agents running: ${agents.join(", ")}\n\n`);
  }
  if (card.usage?.usedTokens) {
    const { contextTokens, usedTokens, compactions } = card.usage;
    md.appendText(`${contextTokens ? `Context ${formatTokens(contextTokens)} · ` : ""}${formatTokens(usedTokens)} used${compactions ? ` · compacted ×${compactions}` : ""}\n\n`);
  }
  for (const pr of card.prs) {
    md.appendMarkdown(`- [${pr.key}](${pr.url}) ${pr.state}${pr.isDraft ? " draft" : ""}\n`);
  }
  return md;
}

function formatTokens(n: number): string {
  if (n >= 1e6) {
    return `${(n / 1e6).toFixed(1)}M`;
  }
  return n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);
}
