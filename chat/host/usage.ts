import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { PlanUsage } from "../../src/chat/protocol";
import type { ChatSession } from "./ChatSession";

const WINDOWS = [
  { key: "five_hour", label: "5-hour" },
  { key: "seven_day", label: "Weekly" }
] as const;

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

// Not in sdk.d.ts's Query yet, but the 0.3.x runtime ships it (get_task_output control request).
type TaskOutputQuery = Query & { getTaskOutput?(taskId: string): Promise<{ output: string; truncated: boolean }> };

// Undefined when the call failed, so the pane keeps what it last showed; null when plan limits don't apply.
export async function planUsage(session: ChatSession): Promise<PlanUsage | null | undefined> {
  if (!session.activeQuery) {
    return undefined;
  }
  try {
    const usage = await session.activeQuery.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
    if (!usage.rate_limits_available || !usage.rate_limits) {
      return null;
    }
    const limits = usage.rate_limits;
    const windows = WINDOWS.flatMap(({ key, label }) => {
      const window = limits[key];
      if (typeof window?.utilization !== "number") {
        return [];
      }
      const resetsAt = window.resets_at ? Date.parse(window.resets_at) : NaN;
      return [{ key, label, percent: Math.min(100, Math.max(0, Math.round(window.utilization))), resetsAt: Number.isNaN(resetsAt) ? undefined : resetsAt }];
    });
    return windows.length > 0 ? { windows } : null;
  } catch {
    return undefined;
  }
}

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
