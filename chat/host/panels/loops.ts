import * as fs from "fs";
import * as path from "path";
import { parseScheduledTasks } from "../../../src/chat/loops";
import type { LoopsPanelData } from "../../../src/chat/panels/loops";
import type { PanelHandler } from "./types";

export const loopsPanel: PanelHandler<LoopsPanelData> = {
  load: async (session) => {
    const file = path.join(session.meta.cwd, ".claude", "scheduled_tasks.json");
    return {
      durable: fs.existsSync(file) ? parseScheduledTasks(fs.readFileSync(file, "utf8")) : [],
      session: session.sessionCrons?.map(({ id, schedule, recurring, prompt }) => ({ id, schedule, recurring, prompt }))
    };
  },
  action: async (session, action, payload) => {
    if (action === "new") {
      session.fillComposer("/loop ");
    } else if (action === "delete") {
      session.send(`Delete the loop ${String(payload)} with CronDelete.`);
    }
  }
};
