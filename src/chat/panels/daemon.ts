import type { ConfigRow, DaemonStatus } from "../daemon";

export interface DaemonPanelData {
  status: DaemonStatus;
  raw: string;
  config: ConfigRow[];
  // Set when daemon.json exists, even if nothing in it could be summarised.
  configFile?: string;
}
