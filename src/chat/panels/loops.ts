import type { LoopRow } from "../loops";

export interface LoopsPanelData {
  durable: LoopRow[];
  // Unknown until a turn has ended: the CLI only reports session loops when it stops.
  session?: LoopRow[];
  // A running session holds the lock, so Argus asks Claude to delete instead of editing the file.
}
