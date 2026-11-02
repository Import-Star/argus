import { shapeSkills, type SkillsPanelData } from "../../../src/chat/panels/skills";
import type { PanelHandler } from "./types";

export const skillsPanel: PanelHandler<SkillsPanelData> = {
  load: async (session) => {
    const q = session.activeQuery;
    if (!q) {
      return { skills: [], hasTokens: false };
    }
    const [commands, usage] = await Promise.all([q.supportedCommands(), q.getContextUsage({ detail: "full" }).catch(() => undefined)]);
    return shapeSkills(commands, usage);
  }
};
