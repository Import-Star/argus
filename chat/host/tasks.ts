import { getSubagentMessages, listSubagents, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ChatSession } from "./ChatSession";

const MAX_CHARS = 4000;

function describeBlock(block: { type?: string; text?: string; name?: string; input?: Record<string, unknown> }): string {
  if (block.type === "text") {
    return block.text?.trim() ?? "";
  }
  if (block.type !== "tool_use") {
    return "";
  }
  const arg = block.input?.file_path ?? block.input?.command ?? block.input?.pattern ?? block.input?.description ?? "";
  return `${block.name ?? "tool"}  ${String(arg).split("\n")[0].slice(0, 120)}`.trimEnd();
}

function assistantText(message: unknown): string {
  const content = (message as { content?: unknown } | undefined)?.content;
  const blocks = Array.isArray(content) ? content : [];
  return blocks.map(describeBlock).filter(Boolean).join("\n");
}

// Standalone task_ids are the agent id (sometimes one-letter prefixed); workflow agents pass their agentId.
// listSubagents also finds subagents/workflows/<run>/agent-<id>.jsonl.
async function findAgentId(sessionId: string, cwd: string, taskId: string): Promise<string | undefined> {
  const ids = await listSubagents(sessionId, { dir: cwd });
  return ids.find((id) => id === taskId) ?? ids.find((id) => id.endsWith(taskId) || taskId.endsWith(id));
}

async function readAgent(session: ChatSession, taskId: string) {
  const agentId = await findAgentId(session.sessionId, session.meta.cwd, taskId);
  return agentId ? getSubagentMessages(session.sessionId, agentId, { dir: session.meta.cwd }) : undefined;
}

export async function agentMessages(session: ChatSession, taskId: string): Promise<SDKMessage[]> {
  return ((await readAgent(session, taskId)) ?? []) as unknown as SDKMessage[];
}

export async function taskOutput(session: ChatSession, taskId: string): Promise<string> {
  try {
    const messages = await readAgent(session, taskId);
    if (!messages) {
      return "No transcript for this agent yet.";
    }
    const lines = messages.filter((message) => message.type === "assistant").map((message) => assistantText(message.message)).filter(Boolean);
    const text = lines.join("\n\n");
    return text.length > MAX_CHARS ? text.slice(-MAX_CHARS) : text || "No output yet.";
  } catch (error) {
    return `Could not read the agent output: ${error instanceof Error ? error.message : String(error)}`;
  }
}
