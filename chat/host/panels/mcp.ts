import * as vscode from "vscode";
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import { callbackUrlProblem, toMcpServers, type McpAuthenticateResponse, type McpPanelData } from "../../../src/chat/panels/mcp";
import type { ChatSession } from "../ChatSession";
import { refreshPanel } from "./index";
import type { PanelHandler } from "./types";

// How often a sign-in checks whether the server came back, and when it gives up waiting on the browser.
const POLL_MS = 2000;
const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;

interface SignIn {
  server: string;
  authUrl?: string;
  callbackExpected: boolean;
  timer: ReturnType<typeof setTimeout>;
}

// The SDK methods behind the official extension's MCP sign-in. They aren't in the SDK's published types, so a CLI or
// SDK without them falls back to `claude /mcp` in a terminal.
interface McpAuthQuery {
  mcpAuthenticate?(serverName: string): Promise<McpAuthenticateResponse | undefined>;
  mcpSubmitOAuthCallbackUrl?(serverName: string, callbackUrl: string): Promise<{ error?: string } | undefined>;
}

const authQuery = (q: Query | undefined): McpAuthQuery | undefined => q as McpAuthQuery | undefined;

const results = new WeakMap<ChatSession, McpPanelData["result"]>();
const signIns = new WeakMap<ChatSession, SignIn>();

export const mcpPanel: PanelHandler<McpPanelData> = {
  load: async (session) => {
    const statuses = await session.activeQuery?.mcpServerStatus();
    const servers = toMcpServers(statuses ?? []);
    session.setMcpServers(servers);
    const result = results.get(session);
    results.delete(session);
    const signIn = signIns.get(session);
    return { started: Boolean(statuses), servers, result, signIn: signIn && { server: signIn.server, callbackExpected: signIn.callbackExpected } };
  },
  action: async (session, action, payload) => {
    if (action === "authenticate") {
      return authenticate(session, String(payload));
    }
    if (action === "openSignIn") {
      const url = signIns.get(session)?.authUrl;
      if (url) {
        await vscode.env.openExternal(vscode.Uri.parse(url, true));
      }
      return;
    }
    if (action === "cancelSignIn") {
      return endSignIn(session);
    }
    if (action === "submitCallback") {
      return submitCallback(session, String(payload));
    }
    const name = String(payload);
    const q = session.activeQuery;
    try {
      if (action === "enable" || action === "disable") {
        await q?.toggleMcpServer(name, action === "enable");
      } else if (action === "reconnect") {
        await q?.reconnectMcpServer(name);
      }
      results.set(session, { server: name, action });
    } catch (error) {
      results.set(session, { server: name, action, error: message(error) });
    }
  }
};

// Starts the server's OAuth sign-in in Claude Code, which hands back the provider's sign-in page and listens on
// localhost for the browser to come back. Argus opens the page, then watches the server until it connects.
async function authenticate(session: ChatSession, server: string): Promise<void> {
  const q = authQuery(session.activeQuery);
  if (!q?.mcpAuthenticate) {
    return authenticateInTerminal(session);
  }
  endSignIn(session);
  let reply: McpAuthenticateResponse | undefined;
  try {
    reply = await q.mcpAuthenticate(server);
    if (reply?.error) {
      throw new Error(reply.error);
    }
  } catch (error) {
    results.set(session, { server, action: "authenticate", error: message(error) });
    return;
  }
  const authUrl = reply?.authUrl;
  if (authUrl) {
    await vscode.env.openExternal(vscode.Uri.parse(authUrl, true));
  }
  if (authUrl && reply?.callbackExpected === false) {
    // A claude.ai connector signs in on claude.ai, and Claude Code doesn't hear when that's done: the row says to
    // press Reconnect afterwards.
    signIns.set(session, { server, authUrl, callbackExpected: false, timer: setTimeout(() => endSignIn(session), SIGN_IN_TIMEOUT_MS) });
    return;
  }
  // No page to open means the stored sign-in was still good and Claude Code is already reconnecting.
  watch(session, { server, authUrl, callbackExpected: Boolean(authUrl) });
}

// Claude Code reconnects the server once the browser comes back, so poll its status and reload the panel on a change.
function watch(session: ChatSession, signIn: Omit<SignIn, "timer">): void {
  const started = Date.now();
  let last: string | undefined;
  const timer = setInterval(() => {
    void (async () => {
      const q = session.activeQuery;
      if (!q || signIns.get(session)?.timer !== timer) {
        return clearInterval(timer);
      }
      const status = (await q.mcpServerStatus().catch(() => [])).find((entry) => entry.name === signIn.server)?.status;
      if (status === "connected") {
        endSignIn(session);
        results.set(session, { server: signIn.server, action: "authenticate" });
      } else if (Date.now() - started > SIGN_IN_TIMEOUT_MS) {
        endSignIn(session);
        results.set(session, { server: signIn.server, action: "authenticate", error: "Timed out waiting for the browser sign-in." });
      } else if (status === last) {
        return;
      }
      last = status;
      await refreshPanel(session, "mcp");
    })();
  }, POLL_MS);
  signIns.set(session, { ...signIn, timer });
}

function endSignIn(session: ChatSession): void {
  const signIn = signIns.get(session);
  if (signIn) {
    clearTimeout(signIn.timer);
    clearInterval(signIn.timer);
    signIns.delete(session);
  }
}

// For when the browser can't reach Claude Code's localhost callback (a remote window, say): the page it ended on still
// carries the code, so the user pastes its address and Claude Code finishes the sign-in with it.
async function submitCallback(session: ChatSession, text: string): Promise<void> {
  const signIn = signIns.get(session);
  if (!signIn) {
    return;
  }
  try {
    const problem = callbackUrlProblem(text);
    if (problem) {
      throw new Error(problem);
    }
    const reply = await authQuery(session.activeQuery)?.mcpSubmitOAuthCallbackUrl?.(signIn.server, text.trim());
    if (reply?.error) {
      throw new Error(reply.error);
    }
  } catch (error) {
    results.set(session, { server: signIn.server, action: "authenticate", error: message(error) });
  }
}

function authenticateInTerminal(session: ChatSession): void {
  const shell = vscode.window.createTerminal({ name: "Claude /mcp", cwd: session.meta.cwd, shellPath: session.claudePath ?? "claude", shellArgs: ["/mcp"] });
  shell.show();
  void vscode.window.showInformationMessage("Argus: pick the server in /mcp and authenticate, then press Reconnect in the MCP panel.");
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
