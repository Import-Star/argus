declare module "*.css";

// media/search.js: the search overlay, shared with the Control Center.
interface Window {
  argusSearch: {
    init(post: (message: import("../../src/chat/protocol").WebviewMessage) => void): void;
    // True when the message was the overlay's.
    onMessage(message: { type: string }): boolean;
  };
}
