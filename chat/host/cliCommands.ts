import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { conversationMarkdown, conversationTurns, nthLatestReply, parseReplyIndex } from "../../src/chat/conversationText";
import type { CliCommandName } from "../../src/chat/localCommands";
import type { ChatManager } from "./ChatManager";
import type { ChatSession } from "./ChatSession";

// Read from disk, not session.history(), which is cached and misses what was said since the chat opened.
const saved = (session: ChatSession) => getSessionMessages(session.sessionId, { dir: session.meta.cwd }).catch(() => []);

export async function runCliCommand(manager: ChatManager, session: ChatSession, name: CliCommandName, args: string): Promise<void> {
  switch (name) {
    case "export":
      return exportChat(session, args);
    case "copy":
      return copyReply(session, args);
    case "branch":
      return branch(manager, session);
    case "plan":
      return plan(session);
  }
}

async function exportChat(session: ChatSession, args: string): Promise<void> {
  const turns = conversationTurns(await saved(session));
  if (turns.length === 0) {
    void vscode.window.showWarningMessage("Argus: nothing to export yet.");
    return;
  }
  const title = session.meta.title || "Conversation";
  const markdown = conversationMarkdown(title, turns);
  if (args) {
    const file = path.resolve(session.meta.cwd, args);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, markdown);
    void vscode.window.showInformationMessage(`Argus: exported to ${file}.`);
    return;
  }
  const choice = await vscode.window.showQuickPick(["Save to file…", "Copy to clipboard"], { placeHolder: "Export this conversation as Markdown" });
  if (choice === "Copy to clipboard") {
    await vscode.env.clipboard.writeText(markdown);
    void vscode.window.showInformationMessage("Argus: conversation copied to the clipboard.");
  } else if (choice) {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "conversation";
    const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(session.meta.cwd, `${slug}.md`)), filters: { Markdown: ["md"] } });
    if (target) {
      await vscode.workspace.fs.writeFile(target, Buffer.from(markdown));
      void vscode.window.showInformationMessage(`Argus: exported to ${target.fsPath}.`);
    }
  }
}

async function copyReply(session: ChatSession, args: string): Promise<void> {
  const n = parseReplyIndex(args);
  if (n === undefined) {
    void vscode.window.showWarningMessage("Argus: use /copy or /copy N, where N is 1 for the latest reply.");
    return;
  }
  const reply = nthLatestReply(conversationTurns(await saved(session)), n);
  if (!reply) {
    void vscode.window.showWarningMessage(n === 1 ? "Argus: Claude hasn't replied yet." : `Argus: there is no reply number ${n}.`);
    return;
  }
  await vscode.env.clipboard.writeText(reply);
  void vscode.window.showInformationMessage("Argus: copied Claude's reply to the clipboard.");
}

async function branch(manager: ChatManager, session: ChatSession): Promise<void> {
  if (session.busy) {
    void vscode.window.showWarningMessage("Argus: wait until Claude has finished this turn before branching.");
    return;
  }
  const last = (await saved(session)).at(-1);
  if (!last) {
    void vscode.window.showWarningMessage("Argus: nothing to branch from yet.");
    return;
  }
  await manager.forkAgent(session.sessionId, last.uuid, false);
}

async function plan(session: ChatSession): Promise<void> {
  if (session.meta.permissionMode === "plan") {
    session.showPlan();
  } else {
    await session.setPermissionMode("plan");
    void vscode.window.showInformationMessage("Argus: plan mode is on. Claude will plan before making changes.");
  }
}
