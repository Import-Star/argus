import type { SDKMessage } from "../../src/chat/protocol";

// Drops the rewound message and everything after it; the marker tells buildItems the cost total jumped.
export function rewindMessages(messages: SDKMessage[], userMessageId: string): SDKMessage[] {
  const at = messages.findIndex((message) => (message as { uuid?: string }).uuid === userMessageId);
  return at < 0 ? messages : [...messages.slice(0, at), { type: "system", subtype: "rewound" } as unknown as SDKMessage];
}
