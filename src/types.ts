export type {
  SessionState,
  SessionColumn,
  SessionRecord,
  PrCheck,
  PrReviewer,
  PrSummary,
  SessionCard,
  SessionUsage,
  SessionTimer,
  SessionChip,
  ChatDetailsSection,
  ChatDetailsItem,
  ChatDetailsProvider,
  ArgusChatExtension,
  ChatExtensionHandle,
  CleanupItem,
  ArgusTab,
  TabHandle,
  ArgusApi,
  PluginConfig,
  ArgusPluginContext,
  ArgusPluginModule
} from "../api";

// Core-internal state, not part of the plugin API.
export interface SessionBoardState {
  archived: Record<string, number>;
  readAt: Record<string, number>;
  groupOf: Record<string, string>;
}
