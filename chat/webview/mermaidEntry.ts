// Built on its own into out/chat/mermaid.js, which the chat loads the first time a reply has a diagram.
import mermaid from "mermaid";

(globalThis as { argusMermaid?: typeof mermaid }).argusMermaid = mermaid;
