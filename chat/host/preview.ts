import * as vscode from "vscode";

function webUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

export async function openInSimpleBrowser(url: string): Promise<void> {
  const target = webUrl(url);
  if (!target) {
    void vscode.window.showErrorMessage(`Argus chat: cannot open ${url} in Simple Browser`);
    return;
  }
  await vscode.commands.executeCommand("simpleBrowser.show", target);
}
