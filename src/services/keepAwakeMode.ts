import * as vscode from "vscode";

export type KeepAwakeMode = "off" | "on" | "auto";

export function keepAwakeMode(): KeepAwakeMode {
  const config = vscode.workspace.getConfiguration("argus.keepAwake");
  const mode = config.inspect<KeepAwakeMode>("mode");
  if (mode?.workspaceFolderValue ?? mode?.workspaceValue ?? mode?.globalValue) {
    return config.get<KeepAwakeMode>("mode", "off");
  }
  // Settings from before argus.keepAwake.mode existed.
  return config.get<boolean>("whileAgentsRun", false) ? "auto" : "off";
}

const CHOICES: { mode: KeepAwakeMode; label: string; detail: string }[] = [
  { mode: "off", label: "Off", detail: "Let this machine sleep as normal." },
  { mode: "on", label: "On", detail: "Keep this machine awake until you turn it off, whatever the agents are doing." },
  { mode: "auto", label: "Auto", detail: "Keep this machine awake while a session in this window is working or scheduled, and for 2 minutes after." }
];

export async function chooseKeepAwakeMode(): Promise<void> {
  const current = keepAwakeMode();
  const picked = await vscode.window.showQuickPick(
    CHOICES.map((choice) => ({ ...choice, description: choice.mode === current ? "current" : undefined })),
    { title: "Keep this machine awake" }
  );
  if (picked && picked.mode !== current) {
    await vscode.workspace.getConfiguration("argus.keepAwake").update("mode", picked.mode, vscode.ConfigurationTarget.Global);
  }
}
