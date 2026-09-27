export type {
  SessionState,
  SessionColumn,
  SessionRecord,
  PrCheck,
  PrReviewer,
  PrSummary,
  SessionCard,
  SessionChip,
  CleanupItem,
  ArgusTab,
  TabHandle,
  ArgusApi
} from "../api";

// Core-internal state, not part of the plugin API.
export interface SessionBoardState {
  archived: Record<string, number>;
  readAt: Record<string, number>;
}
