import * as vscode from "vscode";
import type { PickerName } from "../../src/chat/localCommands";
import { AUTOCOMPACT_WINDOWS, COLOR_NAMES, EXTRA_EFFORTS } from "../../src/chat/pickers";
import type { EffortLevel } from "../../src/chat/protocol";
import type { ChatManager } from "./ChatManager";
import type { ChatSession } from "./ChatSession";

interface Choice {
  label: string;
  description?: string;
  value: string;
}

const CURRENT = "current";

async function choose(placeHolder: string, choices: Choice[], current?: string): Promise<Choice | undefined> {
  return vscode.window.showQuickPick(
    choices.map((choice) => ({ ...choice, description: [choice.description, choice.value === current ? CURRENT : undefined].filter(Boolean).join(" · ") })),
    { placeHolder }
  );
}

const plain = (values: string[]): Choice[] => values.map((value) => ({ label: value, value }));

export async function runPicker(manager: ChatManager, session: ChatSession, name: PickerName): Promise<void> {
  switch (name) {
    case "model":
      return pickModel(manager, session);
    case "effort":
      return pickEffort(manager, session);
    case "output-style": {
      const { outputStyle, outputStyles } = await session.initInfo();
      return sendChoice(session, name, "Which output style?", plain(outputStyles), outputStyle);
    }
    case "advisor": {
      const { advisor } = await session.settings();
      return sendChoice(session, name, "Which model should Claude consult?", plain(["fable", "opus", "sonnet", "off"]), advisor ?? "off");
    }
    case "autocompact":
      return pickAutocompact(session);
    case "color":
      return pickColor(manager, session);
  }
}

async function sendChoice(session: ChatSession, command: string, placeHolder: string, choices: Choice[], current?: string): Promise<void> {
  const picked = await choose(placeHolder, choices, current);
  if (picked) {
    session.send(`/${command} ${picked.value}`);
  }
}

async function pickModel(manager: ChatManager, session: ChatSession): Promise<void> {
  const picked = await choose(
    "Which model for this chat?",
    session.meta.models.map((model) => ({ label: model.displayName, value: model.value })),
    session.meta.model
  );
  if (picked) {
    await session.setModel(picked.value);
    manager.remember(session.sessionId, { model: picked.value });
  }
}

async function pickEffort(manager: ChatManager, session: ChatSession): Promise<void> {
  const efforts = session.meta.models.find((model) => model.value === session.meta.model)?.efforts ?? [];
  const picked = await choose(
    "Which effort level?",
    [...plain(efforts), ...EXTRA_EFFORTS.map((extra) => ({ label: extra.label, description: extra.description, value: extra.command }))],
    session.meta.effort
  );
  if (!picked) {
    return;
  }
  if (efforts.includes(picked.value as EffortLevel)) {
    await session.setEffort(picked.value as EffortLevel);
    manager.remember(session.sessionId, { effort: picked.value as EffortLevel });
  } else {
    session.send(`/effort ${picked.value}`);
  }
}

// The CLI doesn't report the current window as data, so nothing is marked.
async function pickAutocompact(session: ChatSession): Promise<void> {
  const custom = { label: "Custom…", value: "" };
  const picked = await choose("Auto-compact window (tokens)", [...plain(AUTOCOMPACT_WINDOWS), custom]);
  const value = picked?.value === custom.value ? await vscode.window.showInputBox({ prompt: "Auto-compact window: auto, or 100k to 1m tokens", placeHolder: "400k" }) : picked?.value;
  if (value?.trim()) {
    session.send(`/autocompact ${value.trim()}`);
  }
}

async function pickColor(manager: ChatManager, session: ChatSession): Promise<void> {
  const picked = await choose("Which colour for this chat?", plain(COLOR_NAMES), session.meta.color ?? "default");
  if (!picked) {
    return;
  }
  session.send(`/color ${picked.value}`);
  const color = picked.value === "default" ? undefined : picked.value;
  session.setColor(color);
  manager.remember(session.sessionId, { color });
}
