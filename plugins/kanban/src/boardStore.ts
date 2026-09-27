import * as path from "path";
import * as vscode from "vscode";
import { BoardData, Card, Column } from "./types";

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultBoard(): BoardData {
  return {
    version: 1,
    columns: [
      { id: createId("col"), name: "Inbox", cards: [] },
      { id: createId("col"), name: "In Progress", cards: [] },
      { id: createId("col"), name: "Review", cards: [] },
      { id: createId("col"), name: "Done", cards: [] }
    ]
  };
}

function isCard(value: unknown): value is Card {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Card;
  return typeof candidate.id === "string" && typeof candidate.text === "string";
}

function isColumn(value: unknown): value is Column {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Column;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    Array.isArray(candidate.cards) &&
    candidate.cards.every((card) => isCard(card))
  );
}

function assertBoard(board: unknown): asserts board is BoardData {
  if (!board || typeof board !== "object") {
    throw new Error("Board JSON is invalid: expected object.");
  }

  const candidate = board as BoardData;
  if (candidate.version !== 1) {
    throw new Error("Board JSON is invalid: expected version 1.");
  }

  if (!Array.isArray(candidate.columns) || !candidate.columns.every((col) => isColumn(col))) {
    throw new Error("Board JSON is invalid: columns are malformed.");
  }

  const columnIds = new Set<string>();
  const cardIds = new Set<string>();

  for (const column of candidate.columns) {
    if (columnIds.has(column.id)) {
      throw new Error(`Board JSON is invalid: duplicate column id ${column.id}.`);
    }
    columnIds.add(column.id);

    for (const card of column.cards) {
      if (cardIds.has(card.id)) {
        throw new Error(`Board JSON is invalid: duplicate card id ${card.id}.`);
      }
      cardIds.add(card.id);
    }
  }
}

// Owns the board JSON file. Never creates it implicitly: callers check boardExists() (or catch the
// "no such file" error from readBoard/mutate) and offer a "Create board" action that calls createBoard().
export class BoardStore {
  public resolveBoardUri(): vscode.Uri | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return undefined;
    }

    const configured = vscode.workspace.getConfiguration("argus").get<string>("kanban.boardFile", "active-work.json").trim();

    if (path.isAbsolute(configured)) {
      return vscode.Uri.file(configured);
    }

    const normalized = configured.length > 0 ? configured : "active-work.json";
    return vscode.Uri.joinPath(folder.uri, ...normalized.split("/"));
  }

  public async boardExists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  public async createBoard(uri: vscode.Uri): Promise<BoardData> {
    const board = defaultBoard();
    await this.saveBoard(uri, board);
    return board;
  }

  public async readBoard(uri: vscode.Uri): Promise<BoardData> {
    const raw = await vscode.workspace.fs.readFile(uri);
    const parsed = JSON.parse(Buffer.from(raw).toString("utf8"));
    assertBoard(parsed);
    return parsed;
  }

  public async saveBoard(uri: vscode.Uri, board: BoardData): Promise<void> {
    assertBoard(board);
    const content = `${JSON.stringify(board, null, 2)}\n`;
    await this.ensureDirectory(uri);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
  }

  // Assumes the board file already exists; throws otherwise.
  public async mutate(uri: vscode.Uri, mutator: (board: BoardData) => BoardData | void): Promise<BoardData> {
    const current = await this.readBoard(uri);
    const result = mutator(current);
    const nextBoard = result ?? current;
    assertBoard(nextBoard);
    await this.saveBoard(uri, nextBoard);
    return nextBoard;
  }

  public createId(prefix: "col" | "card"): string {
    return createId(prefix);
  }

  private async ensureDirectory(fileUri: vscode.Uri): Promise<void> {
    const dirUri = vscode.Uri.file(path.dirname(fileUri.fsPath));
    try {
      await vscode.workspace.fs.stat(dirUri);
    } catch {
      await vscode.workspace.fs.createDirectory(dirUri);
    }
  }
}
