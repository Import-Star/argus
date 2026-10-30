import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { agentFolders, agentSlug, agentTemplate, memoryFiles, parseToggle, settingsFiles, type FileChoice, type LocalCommandName } from "../../src/chat/localCommands";
import type { ChatManager } from "./ChatManager";
import type { ChatSession } from "./ChatSession";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Runs a slash command the CLI only has in its terminal UI. Feedback goes to VS Code notifications, not the transcript.
export async function runLocalCommand(manager: ChatManager, session: ChatSession, name: LocalCommandName, args: string): Promise<void> {
  try {
    switch (name) {
      case "remote-control":
        return await remoteControl(session, args);
      case "chrome":
        return await chrome(manager, session, args);
      case "add-dir":
        return await addDir(session, args);
      case "permissions":
        return await openFile(settingsFiles(session.meta.cwd, os.homedir()), "Edit permission rules in which settings file?", "{}\n");
      case "hooks":
        return await openFile(settingsFiles(session.meta.cwd, os.homedir()), "Edit hooks in which settings file?", "{}\n");
      case "memory":
        return await openFile(memoryFiles(session.meta.cwd, os.homedir()), "Open which memory file?", "");
      case "agents":
        return await agents(session);
      case "resume":
        return await resume(manager, session);
      case "login":
      case "logout":
      case "plugin":
        return terminal(session, name);
    }
  } catch (error) {
    void vscode.window.showErrorMessage(`Argus: /${name} failed: ${errorText(error)}`);
  }
}

async function remoteControl(session: ChatSession, args: string): Promise<void> {
  const enabled = parseToggle(args, Boolean(session.meta.remoteControlUrl));
  if (enabled === undefined) {
    void vscode.window.showWarningMessage("Argus: use /remote-control, /remote-control on or /remote-control off.");
    return;
  }
  const url = await session.setRemoteControl(enabled);
  if (!enabled) {
    void vscode.window.showInformationMessage("Argus: Remote Control is off for this chat.");
    return;
  }
  if (!url) {
    void vscode.window.showInformationMessage("Argus: Remote Control is on. Find this chat at claude.ai/code or in the Claude app.");
    return;
  }
  const choice = await vscode.window.showInformationMessage("Argus: Remote Control is on. Continue this chat from claude.ai/code or the Claude app.", "Open", "Copy Link");
  if (choice === "Open") {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  } else if (choice === "Copy Link") {
    await vscode.env.clipboard.writeText(url);
  }
}

// Restarting kills background agents and shells, so ask first while any run; never restart mid-turn.
async function canRestart(session: ChatSession, what: string): Promise<boolean> {
  if (session.busy) {
    void vscode.window.showWarningMessage(`Argus: ${what} restarts Claude, so wait until it has finished this turn.`);
    return false;
  }
  if (session.runningBackgroundTasks > 0) {
    const choice = await vscode.window.showWarningMessage(`${what} restarts Claude, which stops the background tasks still running in this chat.`, { modal: true }, "Restart");
    return choice === "Restart";
  }
  return true;
}

async function chrome(manager: ChatManager, session: ChatSession, args: string): Promise<void> {
  const current = Boolean(session.meta.chrome);
  if (args.trim().toLowerCase() === "browser") {
    return pickBrowser(session);
  }
  const enabled = parseToggle(args, current);
  if (enabled === undefined) {
    void vscode.window.showWarningMessage("Argus: use /chrome, /chrome on, /chrome off or /chrome browser.");
    return;
  }
  if (enabled === current) {
    void vscode.window.showInformationMessage(`Argus: Claude in Chrome is already ${current ? "on" : "off"} for this chat.`);
    return;
  }
  if (!(await canRestart(session, `Turning Claude in Chrome ${enabled ? "on" : "off"}`))) {
    return;
  }
  session.setChrome(enabled);
  manager.remember(session.sessionId, { chrome: enabled });
  void vscode.window.showInformationMessage(
    enabled ? "Argus: Claude in Chrome is on for this chat. It needs the Claude extension in Chrome (claude.ai/chrome)." : "Argus: Claude in Chrome is off for this chat."
  );
}

async function pickBrowser(session: ChatSession): Promise<void> {
  if (!session.meta.chrome) {
    void vscode.window.showInformationMessage("Argus: turn Claude in Chrome on first with /chrome on.");
    return;
  }
  const browsers = await session.chromeBrowsers();
  if (browsers.length === 0) {
    void vscode.window.showInformationMessage("Argus: no browser with the Claude extension is connected.");
    return;
  }
  const picked = await vscode.window.showQuickPick(
    browsers.map((browser) => ({ label: browser.name, description: [browser.platform, browser.current ? "in use" : undefined].filter(Boolean).join(" · "), id: browser.id })),
    { placeHolder: "Which browser should Claude control?" }
  );
  if (picked) {
    await session.selectChromeBrowser(picked.id);
  }
}

async function addDir(session: ChatSession, args: string): Promise<void> {
  let folder = args.replace(/^["']|["']$/g, "").trim();
  if (!folder) {
    const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, defaultUri: vscode.Uri.file(session.meta.cwd), openLabel: "Add folder" });
    folder = picked?.[0]?.fsPath ?? "";
    if (!folder) {
      return;
    }
  }
  folder = path.resolve(session.meta.cwd, folder.replace(/^~(?=$|[\\/])/, os.homedir()));
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    void vscode.window.showWarningMessage(`Argus: ${folder} is not a folder.`);
    return;
  }
  if (session.additionalDirectories.includes(folder)) {
    void vscode.window.showInformationMessage(`Argus: Claude can already use ${folder}.`);
    return;
  }
  if (!(await canRestart(session, "Adding a folder"))) {
    return;
  }
  session.addDirectory(folder);
  void vscode.window.showInformationMessage(`Argus: Claude can now use ${folder} in this chat.`);
}

// Opens the picked file, creating it (and its folder) with `empty` when it doesn't exist yet.
async function openFile(choices: FileChoice[], placeHolder: string, empty: string): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    choices.map((choice) => ({ ...choice, detail: fs.existsSync(choice.file) ? choice.file : `${choice.file} (new)` })),
    { placeHolder }
  );
  if (!picked) {
    return;
  }
  if (!fs.existsSync(picked.file)) {
    fs.mkdirSync(path.dirname(picked.file), { recursive: true });
    fs.writeFileSync(picked.file, empty);
  }
  await vscode.window.showTextDocument(vscode.Uri.file(picked.file));
}

async function agents(session: ChatSession): Promise<void> {
  const folders = agentFolders(session.meta.cwd, os.homedir());
  const existing = folders.flatMap((folder) => {
    try {
      return fs
        .readdirSync(folder.file)
        .filter((file) => file.endsWith(".md"))
        .map((file) => ({ label: path.basename(file, ".md"), description: folder.label.replace(/ agent$/, ""), detail: path.join(folder.file, file), file: path.join(folder.file, file) }));
    } catch {
      return [];
    }
  });
  const create = { label: "$(add) New agent…", description: "", detail: undefined, file: "" };
  const picked = await vscode.window.showQuickPick([create, ...existing], { placeHolder: "Open which agent?" });
  if (!picked) {
    return;
  }
  if (picked !== create) {
    await vscode.window.showTextDocument(vscode.Uri.file(picked.file));
    return;
  }
  const where = await vscode.window.showQuickPick(folders, { placeHolder: "Where should the new agent live?" });
  const name = where && (await vscode.window.showInputBox({ prompt: "Agent name", placeHolder: "code-reviewer", validateInput: (value) => (agentSlug(value) ? undefined : "Use letters or numbers") }));
  if (!where || !name) {
    return;
  }
  const slug = agentSlug(name);
  const file = path.join(where.file, `${slug}.md`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(where.file, { recursive: true });
    fs.writeFileSync(file, agentTemplate(slug));
  }
  await vscode.window.showTextDocument(vscode.Uri.file(file));
}

async function resume(manager: ChatManager, session: ChatSession): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    manager
      .rail()
      .filter((entry) => entry.sessionId !== session.sessionId)
      .sort((a, b) => b.since - a.since)
      .map((entry) => ({ label: entry.title, description: [entry.repo, entry.column].filter(Boolean).join(" · "), sessionId: entry.sessionId })),
    { placeHolder: "Open which session?", matchOnDescription: true }
  );
  if (picked) {
    await manager.open(picked.sessionId);
  }
}

// These need the CLI's interactive screens, so they run `claude /<command>` in a VS Code terminal.
function terminal(session: ChatSession, name: "login" | "logout" | "plugin"): void {
  const shell = vscode.window.createTerminal({ name: `Claude /${name}`, cwd: session.meta.cwd, shellPath: session.claudePath ?? "claude", shellArgs: [`/${name}`] });
  shell.show();
  if (name === "plugin") {
    void vscode.window.showInformationMessage("Argus: when you're done in the terminal, run /reload-plugins in this chat to pick up the changes.");
  } else {
    void vscode.window.showInformationMessage(`Argus: finish /${name} in the terminal.`);
  }
}
