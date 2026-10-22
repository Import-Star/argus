import { render } from "preact";
import type { HostMessage } from "../../src/chat/protocol";
import { App } from "./App";
import "./chat.css";
import { dispatch, post } from "./store";

window.addEventListener("message", (event: MessageEvent<HostMessage>) => dispatch(event.data));
render(<App />, document.getElementById("root")!);
post({ type: "ready" });
