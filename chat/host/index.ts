import type { ActivateChat } from "../../src/chat/types";
import { ChatManager } from "./ChatManager";

export const activateChat: ActivateChat = (context, deps) => {
  const manager = new ChatManager(context, deps);
  return {
    open: (sessionId, prompt, column) => manager.open(sessionId, prompt, column),
    openGrid: (sessionIds, groupId) => manager.openGrid(sessionIds, groupId),
    addToGrid: (sessionId) => manager.gridAction("add", sessionId),
    review: (sessionId, target) => manager.review(sessionId, target),
    isChatSession: (sessionId) => manager.isChatSession(sessionId),
    isViewing: (sessionId) => manager.isViewing(sessionId),
    pendingFor: (sessionId) => manager.pendingFor(sessionId),
    respond: (sessionId, id, decision) => manager.respond(sessionId, id, decision),
    send: (sessionId, text) => manager.send(sessionId, text),
    closeSession: (sessionId) => manager.closeSession(sessionId),
    onDidChangePending: manager.onDidChangePending,
    dispose: () => manager.dispose()
  };
};
