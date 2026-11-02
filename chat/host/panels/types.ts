import type { ChatSession } from "../ChatSession";

export interface PanelHandler<Data> {
  load(session: ChatSession): Promise<Data>;
  // Runs a button or field in the panel; the panel reloads afterwards.
  action?(session: ChatSession, action: string, payload: unknown): Promise<void>;
}
