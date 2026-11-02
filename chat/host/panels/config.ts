import { query } from "@anthropic-ai/claude-agent-sdk";
import { parseConfigUsage, type ConfigSetting } from "../../../src/chat/configUsage";
import type { ConfigPanelData } from "../../../src/chat/panels/config";
import type { ChatSession } from "../ChatSession";
import type { PanelHandler } from "./types";

let usage: Promise<ConfigSetting[]> | undefined;

// The settings list only exists as the text of a bare /config, so ask a short-lived CLI once and keep the answer.
// Hooks off, so the board tracker never sees this throwaway session.
function loadSettings(session: ChatSession): Promise<ConfigSetting[]> {
  usage ??= (async () => {
    async function* prompt() {
      yield { type: "user" as const, message: { role: "user" as const, content: "/config" }, parent_tool_use_id: null, session_id: "" };
      await new Promise(() => {});
    }
    const q = query({ prompt: prompt(), options: { cwd: session.meta.cwd, persistSession: false, settings: { disableAllHooks: true }, pathToClaudeCodeExecutable: session.claudePath } });
    try {
      for await (const message of q) {
        if (message.type === "result" && message.subtype === "success") {
          return parseConfigUsage(message.result);
        }
      }
      return [];
    } finally {
      q.close();
    }
  })();
  usage.catch(() => (usage = undefined));
  return usage;
}

export const configPanel: PanelHandler<ConfigPanelData> = {
  load: async (session) => {
    try {
      const [settings, current] = await Promise.all([loadSettings(session), session.settings()]);
      const values = Object.fromEntries(
        settings.flatMap(({ key }) => {
          const value = current.effective[key];
          return ["string", "boolean", "number"].includes(typeof value) ? [[key, String(value)]] : [];
        })
      );
      return { settings, values };
    } catch (error) {
      return { settings: [], values: {}, error: error instanceof Error ? error.message : String(error) };
    }
  },
  action: async (session, action, payload) => {
    const { key, value } = payload as { key: string; value: string };
    if (action === "set" && /^\w+$/.test(key) && !/[\r\n]/.test(value)) {
      session.send(`/config ${key}=${value}`);
    }
  }
};
