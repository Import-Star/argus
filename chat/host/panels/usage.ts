import { shapePeriods, shapeSession, type UsagePanelData } from "../../../src/chat/panels/usage";
import type { PanelHandler } from "./types";

export const usagePanel: PanelHandler<UsagePanelData> = {
  load: async (session) => {
    const plan = session.planUsage();
    const q = session.activeQuery;
    if (!q) {
      return { plan, periods: [] };
    }
    try {
      const usage = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({});
      return { plan, session: shapeSession(usage), periods: shapePeriods(usage.behaviors) };
    } catch {
      return { plan, periods: [] };
    }
  }
};
