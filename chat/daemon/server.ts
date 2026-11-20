import { spawn } from "child_process";
import { createHash, randomBytes } from "crypto";
import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import { daemonPaths } from "../../src/chat/daemonPaths";
import { DAEMON_PROTOCOL, QUERY_UNSUPPORTED, SESSION_METHODS, encodeFrame, frameReader, type ClientFrame, type DaemonFrame, type HelloResult, type OpenOptions } from "../../src/chat/daemonProtocol";
import { hasTranscript } from "../host/restore";
import { AgentSession } from "./AgentSession";

const EXIT_GRACE_MS = 10_000;
const MAX_LOG_BYTES = 5 * 1024 * 1024;

interface Client {
  socket: net.Socket;
  authed: boolean;
  sessions: Set<string>;
}

interface Entry {
  session: AgentSession;
  idleMinutes: number;
  subscribers: Set<Client>;
  lastState: string;
  idleTimer?: NodeJS.Timeout;
}

const paths = daemonPaths();
const clients = new Set<Client>();
const entries = new Map<string, Entry>();
const token = randomBytes(32).toString("hex");
const build = createHash("sha1").update(fs.readFileSync(__filename)).digest("hex");
const builtAt = fs.statSync(__filename).mtimeMs;
let exitTimer: NodeJS.Timeout | undefined;
let nextScript: string | undefined;
let nextBuiltAt: number | undefined;
let server: net.Server | undefined;

function log(line: string): void {
  try {
    fs.appendFileSync(paths.log, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // Logging must never take the daemon down.
  }
}

function send(client: Client, frame: DaemonFrame): void {
  if (!client.socket.destroyed) {
    client.socket.write(encodeFrame(frame));
  }
}

const broadcastLog = (line: string): void => {
  log(line);
  for (const client of clients) {
    if (client.authed) {
      send(client, { event: "log", line });
    }
  }
};

function shutdown(code: number): void {
  for (const entry of entries.values()) {
    entry.session.dispose();
  }
  entries.clear();
  for (const client of clients) {
    client.socket.end();
  }
  server?.close();
  fs.rmSync(paths.info, { force: true });
  if (process.platform !== "win32") {
    fs.rmSync(paths.socket, { force: true });
  }
  // Started here rather than by the windows, whose race to spawn could bring back an older build.
  if (nextScript) {
    spawn(process.execPath, [nextScript], { detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }).unref();
  }
  log(`exit ${code}`);
  setTimeout(() => process.exit(code), 200);
}

function checkExit(): void {
  clearTimeout(exitTimer);
  exitTimer = undefined;
  if (entries.size === 0 && clients.size === 0) {
    exitTimer = setTimeout(() => shutdown(0), EXIT_GRACE_MS);
  }
}

function checkRestart(): void {
  if (nextScript && [...entries.values()].every((entry) => entry.session.stoppable)) {
    log("restarting: every session is idle");
    shutdown(0);
  }
}

function forEach(entry: Entry, frame: DaemonFrame): void {
  for (const client of entry.subscribers) {
    send(client, frame);
  }
}

function closeSession(entry: Entry): void {
  const { sessionId } = entry.session;
  clearTimeout(entry.idleTimer);
  entry.session.dispose();
  entries.delete(sessionId);
  for (const client of entry.subscribers) {
    client.sessions.delete(sessionId);
  }
  forEach(entry, { event: "closed", sessionId });
  checkExit();
}

function checkIdle(entry: Entry): void {
  clearTimeout(entry.idleTimer);
  if (entry.subscribers.size > 0 || !entries.has(entry.session.sessionId) || !entry.session.stoppable) {
    return;
  }
  const wait = entry.session.meta.statusSince + entry.idleMinutes * 60_000 - Date.now();
  if (wait <= 0) {
    log(`idle stop ${entry.session.sessionId}`);
    closeSession(entry);
  } else {
    entry.idleTimer = setTimeout(() => checkIdle(entry), wait);
  }
}

function unsubscribe(client: Client, sessionId: string): void {
  client.sessions.delete(sessionId);
  const entry = entries.get(sessionId);
  if (entry) {
    entry.subscribers.delete(client);
    checkIdle(entry);
  }
}

function createEntry(options: OpenOptions): Entry {
  const { sessionId } = options;
  const entry: Entry = {
    session: new AgentSession({ ...options, log: broadcastLog, refreshPanel: (kind) => forEach(entry, { event: "refreshPanel", sessionId, kind }), newAgent: (request) => {
      const [client] = entry.subscribers;
      if (client) {
        send(client, { event: "newAgent", sessionId, request });
      }
      return Boolean(client);
    } }),
    idleMinutes: options.idleMinutes,
    subscribers: new Set(),
    lastState: ""
  };
  entry.session.onMessage((message) => {
    const state = entry.session.state();
    const json = JSON.stringify(state);
    forEach(entry, { event: "message", sessionId, message, state: json === entry.lastState ? undefined : state });
    entry.lastState = json;
    if (message.type === "meta") {
      checkIdle(entry);
      checkRestart();
    }
  });
  entries.set(sessionId, entry);
  log(`open ${sessionId} cwd=${options.cwd}`);
  return entry;
}

function sessionOf(sessionId: string): AgentSession {
  const entry = entries.get(sessionId);
  if (!entry) {
    throw new Error(`No session ${sessionId}`);
  }
  return entry.session;
}

async function handle(client: Client, frame: ClientFrame): Promise<unknown> {
  switch (frame.op) {
    case "hello": {
      if (frame.token !== token) {
        throw new Error("Bad token");
      }
      // A newer build takes over once every chat is idle, so no turn is cut off.
      if (frame.build !== build && frame.builtAt > builtAt && frame.builtAt > (nextBuiltAt ?? 0)) {
        nextScript = frame.script;
        nextBuiltAt = frame.builtAt;
        setImmediate(checkRestart);
      }
      if (frame.restart && frame.builtAt > builtAt) {
        log("restarting: a window asked to restart now");
        setImmediate(() => shutdown(0));
      }
      client.authed = frame.protocol === DAEMON_PROTOCOL;
      return { protocol: DAEMON_PROTOCOL, build, builtAt, sessions: [...entries.keys()] } satisfies HelloResult;
    }
    case "open": {
      // A window reopening after a restart can't tell whether the chat ever sent a message.
      const entry = entries.get(frame.options.sessionId) ?? createEntry({ ...frame.options, resume: frame.options.resume && hasTranscript(frame.options.sessionId) });
      entry.idleMinutes = frame.options.idleMinutes;
      entry.session.start();
      entry.subscribers.add(client);
      client.sessions.add(frame.options.sessionId);
      clearTimeout(entry.idleTimer);
      clearTimeout(exitTimer);
      const state = entry.session.state();
      entry.lastState = JSON.stringify(state);
      return state;
    }
    case "detach":
      unsubscribe(client, frame.sessionId);
      return undefined;
    case "stop": {
      const entry = entries.get(frame.sessionId);
      if (entry) {
        log(`stop ${frame.sessionId}`);
        closeSession(entry);
      }
      return undefined;
    }
    case "call": {
      if (!(SESSION_METHODS as readonly string[]).includes(frame.method)) {
        throw new Error(`Unknown method ${frame.method}`);
      }
      const session = sessionOf(frame.sessionId);
      return await (session[frame.method] as (...args: unknown[]) => unknown).apply(session, frame.args);
    }
    case "query": {
      const active = sessionOf(frame.sessionId).activeQuery as unknown as Record<string, unknown> | undefined;
      const method = active?.[frame.method];
      if (typeof method !== "function") {
        throw new Error(QUERY_UNSUPPORTED);
      }
      return await method.apply(active, frame.args);
    }
    case "shell": {
      if (frame.method !== "run" && frame.method !== "act") {
        throw new Error(`Unknown shell method ${String(frame.method)}`);
      }
      const shell = sessionOf(frame.sessionId).shell;
      return await (shell[frame.method] as (...args: unknown[]) => unknown).apply(shell, frame.args);
    }
    case "list":
      return [...entries.keys()];
    default:
      throw new Error(`Unknown op ${String((frame as { op?: unknown }).op)}`);
  }
}

async function onFrame(client: Client, raw: unknown): Promise<void> {
  const frame = raw as Partial<ClientFrame> | null;
  const id = typeof frame?.id === "number" ? frame.id : undefined;
  try {
    if (!frame || typeof frame.op !== "string" || id === undefined) {
      throw new Error("Malformed frame");
    }
    if (!client.authed && frame.op !== "hello") {
      throw new Error("hello required");
    }
    send(client, { id, ok: true, result: await handle(client, frame as ClientFrame) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`${frame?.op ?? "?"} failed: ${message}`);
    if (id !== undefined) {
      send(client, { id, ok: false, error: message });
    }
    if (!client.authed) {
      client.socket.end();
    }
  }
}

function onConnection(socket: net.Socket): void {
  const client: Client = { socket, authed: false, sessions: new Set() };
  clients.add(client);
  clearTimeout(exitTimer);
  const read = frameReader((frame) => void onFrame(client, frame));
  socket.on("data", (chunk) => {
    try {
      read(chunk);
    } catch (error) {
      log(`bad frame: ${error instanceof Error ? error.message : String(error)}`);
      socket.destroy();
    }
  });
  socket.on("error", (error) => log(`socket error: ${error.message}`));
  socket.on("close", () => {
    clients.delete(client);
    for (const sessionId of [...client.sessions]) {
      unsubscribe(client, sessionId);
    }
    checkExit();
  });
}

function probe(): Promise<"alive" | "refused" | "absent"> {
  return new Promise((resolve) => {
    const socket = net.connect(paths.socket);
    socket.once("connect", () => {
      socket.destroy();
      resolve("alive");
    });
    socket.once("error", (error: NodeJS.ErrnoException) => resolve(error.code === "ECONNREFUSED" ? "refused" : "absent"));
  });
}

export async function startDaemon(): Promise<void> {
  fs.mkdirSync(path.dirname(paths.log), { recursive: true });
  if (fs.existsSync(paths.log) && fs.statSync(paths.log).size > MAX_LOG_BYTES) {
    fs.rmSync(paths.log);
  }
  process.on("uncaughtException", (error) => log(`uncaught: ${error.stack ?? error.message}`));
  process.on("unhandledRejection", (reason) => log(`unhandled: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`));
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => shutdown(0));
  }

  const existing = await probe();
  if (existing === "alive") {
    process.exit(0);
  }
  if (existing === "refused" && process.platform !== "win32") {
    fs.rmSync(paths.socket, { force: true });
  }

  server = net.createServer(onConnection);
  server.on("error", (error: NodeJS.ErrnoException) => {
    log(`server error: ${error.message}`);
    process.exit(error.code === "EADDRINUSE" ? 0 : 1);
  });
  server.listen(paths.socket, () => {
    if (process.platform !== "win32") {
      fs.chmodSync(paths.socket, 0o600);
    }
    fs.writeFileSync(paths.info, JSON.stringify({ pid: process.pid, token, build, protocol: DAEMON_PROTOCOL }), { mode: 0o600 });
    log(`listening pid=${process.pid} build=${build}`);
    checkExit();
  });
}
