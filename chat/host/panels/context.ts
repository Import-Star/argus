import { shapeContext, type ContextPanelData } from "../../../src/chat/panels/context";
import type { PanelHandler } from "./types";

export const contextPanel: PanelHandler<ContextPanelData> = {
  load: async (session) => {
    const q = session.activeQuery;
    return q ? shapeContext(await q.getContextUsage({ detail: "full" })) : null;
  }
};
