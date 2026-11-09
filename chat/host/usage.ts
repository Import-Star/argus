import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { ChatSession } from "./ChatSession";

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

// Not in sdk.d.ts's Query yet, but the 0.3.x runtime ships it (get_task_output control request).
type TaskOutputQuery = Query & { getTaskOutput?(taskId: string): Promise<{ output: string; truncated: boolean }> };

// Undefined for anything that isn't a shell or monitor task (agents read from their transcript instead).
export async function shellTaskOutput(session: ChatSession, taskId: string): Promise<string | undefined> {
  const q = session.activeQuery as TaskOutputQuery | undefined;
  if (!q?.getTaskOutput) {
    return undefined;
  }
  try {
    const { output, truncated } = await q.getTaskOutput(taskId);
    const text = output.replace(ANSI, "").trimEnd();
    return text ? (truncated ? `... last 8 KiB\n${text}` : text) : "No output yet.";
  } catch {
    return undefined;
  }
}
