// Colours the CLI accepts for /color; "default" clears it. Hex values are what the chat header shows.
export const SESSION_COLORS = {
  red: "#e5534b",
  blue: "#4c8dff",
  green: "#3fb950",
  yellow: "#d4a72c",
  purple: "#a371f7",
  orange: "#f0883e",
  pink: "#f06292",
  cyan: "#39c5cf"
} as const;

export const COLOR_NAMES = [...Object.keys(SESSION_COLORS), "default"];

// /autocompact takes "auto" or 100k to 1M tokens; these are the common picks.
export const AUTOCOMPACT_WINDOWS = ["auto", "100k", "200k", "300k", "500k", "750k", "1m"];

// Effort settings the CLI only takes as text: a model-chosen level, and ultracode's on/off.
export const EXTRA_EFFORTS = [
  { command: "auto", label: "auto", description: "Let the model pick" },
  { command: "ultracode on", label: "ultracode on", description: "Standing workflow orchestration" },
  { command: "ultracode off", label: "ultracode off", description: "Keep the current effort" }
];
