import { spawn } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as net from "net";
import * as vscode from "vscode";
import { DAEMON_PROTOCOL, encodeFrame, frameReader, type ClientRequest, type DaemonFrame, type HelloResult } from "../../src/chat/daemonProtocol";
import { daemonPaths } from "../../src/chat/daemonPaths";

const CONNECT_TIMEOUT_MS = 10_000;
const RETRY_MS = 200;
const RECONNECT_MS = 5_000;
const OUTDATED_RETRY_MS = 3_000;
const RESTART_GRACE_MS = 3_000;

export interface SessionListener {
  event(frame: Extract<DaemonFrame, { sessionId: string }>): void;
  reopen(): void;
}

interface Pending {
  resolve(result: unknown): void;
  reject(error: Error): void;
}

// A reconnect follows, so callers can ignore it.
export class ConnectionLostError extends Error {
  constructor() {
    super("Lost the connection to the Argus chat background process.");
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

function tryConnect(socketPath: string): Promise<net.Socket | undefined> {
  return new Promise((resolve) => {
    const socket = net.connect(socketPath);
    socket.once("connect", () => resolve(socket));
    socket.once("error", () => resolve(undefined));
  });
}

export class DaemonClient implements vscode.Disposable {
  private socket?: net.Socket;
  private connection?: Promise<net.Socket>;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, SessionListener>();
  private disposed = false;
  private warnedOutdated = false;
  private lostConnection = false;

  constructor(private readonly extensionUri: vscode.Uri, private readonly log: (line: string) => void) {}

  public attach(sessionId: string, listener: SessionListener): void {
    this.listeners.set(sessionId, listener);
  }

  public detach(sessionId: string): void {
    this.listeners.delete(sessionId);
  }

  public request<T = unknown>(request: ClientRequest): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new Error("Argus chat is shutting down."));
    }
    // Written in the same tick when connected, so requests sent just before dispose still go out.
    return this.socket ? this.write<T>(this.socket, request) : this.connect().then((socket) => this.write<T>(socket, request));
  }

  public async isLive(sessionId: string): Promise<boolean> {
    try {
      return (await this.request<string[]>({ op: "list" })).includes(sessionId);
    } catch (error) {
      this.log(`daemon list: ${describe(error)}`);
      return false;
    }
  }

  // Pending requests are left unanswered: the frames are already written, and failing them would only log noise.
  public dispose(): void {
    this.disposed = true;
    this.socket?.end();
  }

  private write<T>(socket: net.Socket, request: ClientRequest): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve: resolve as (result: unknown) => void, reject });
      socket.write(encodeFrame({ id, ...request }));
    });
  }

  private connect(): Promise<net.Socket> {
    this.connection ??= this.establish().then(
      (socket) => {
        this.socket = socket;
        return socket;
      },
      (error) => {
        this.connection = undefined;
        throw error;
      }
    );
    return this.connection;
  }

  private async establish(): Promise<net.Socket> {
    while (!this.disposed) {
      const socket = await this.reach();
      socket.on("data", frameReader((frame) => this.onFrame(frame as DaemonFrame)));
      socket.on("error", (error) => this.log(`daemon socket: ${describe(error)}`));
      socket.on("close", () => this.onClose(socket));
      const own = this.ownBuild();
      const hello = await this.hello(socket, own);
      if (hello.protocol === DAEMON_PROTOCOL) {
        this.lostConnection = false;
        return socket;
      }
      socket.destroy();
      if (hello.builtAt > own.builtAt) {
        throw new Error("Argus was updated in another window. Reload this window to keep using Argus chat.");
      }
      this.warnOutdated();
      await sleep(OUTDATED_RETRY_MS);
    }
    throw new Error("Argus chat is shutting down.");
  }

  // Connects to the running daemon, starting one first when nothing answers.
  private async reach(): Promise<net.Socket> {
    const { socket: socketPath } = daemonPaths();
    let socket = await tryConnect(socketPath);
    // After a restart the old daemon starts the new one; give it time before racing it.
    const grace = this.lostConnection ? Date.now() + RESTART_GRACE_MS : 0;
    while (!socket && Date.now() < grace) {
      await sleep(RETRY_MS);
      socket = await tryConnect(socketPath);
    }
    if (!socket) {
      this.spawnDaemon();
      const deadline = Date.now() + CONNECT_TIMEOUT_MS;
      while (!socket && Date.now() < deadline) {
        await sleep(RETRY_MS);
        socket = await tryConnect(socketPath);
      }
    }
    if (!socket) {
      throw new Error("The Argus chat background process didn't start. See its log at " + daemonPaths().log);
    }
    return socket;
  }

  // The info file is written after the daemon listens, so a connected socket may need a moment before its token is readable.
  private async hello(socket: net.Socket, own: { build: string; builtAt: number; script: string }): Promise<HelloResult> {
    const deadline = Date.now() + CONNECT_TIMEOUT_MS;
    for (;;) {
      try {
        if (socket.destroyed) {
          throw new Error("connection closed");
        }
        const { token } = JSON.parse(fs.readFileSync(daemonPaths().info, "utf8")) as { token: string };
        return await this.write<HelloResult>(socket, { op: "hello", token, protocol: DAEMON_PROTOCOL, ...own });
      } catch (error) {
        if (Date.now() >= deadline) {
          socket.destroy();
          throw new Error(`Couldn't sign in to the Argus chat background process: ${describe(error)}`);
        }
        await sleep(RETRY_MS);
      }
    }
  }

  private ownBuild(): { build: string; builtAt: number; script: string } {
    const script = this.daemonScript();
    return { build: createHash("sha1").update(fs.readFileSync(script)).digest("hex"), builtAt: fs.statSync(script).mtimeMs, script };
  }

  private daemonScript(): string {
    return vscode.Uri.joinPath(this.extensionUri, "out", "chat", "daemon.js").fsPath;
  }

  private spawnDaemon(): void {
    spawn(process.execPath, [this.daemonScript()], { detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }).unref();
  }

  private warnOutdated(): void {
    if (!this.warnedOutdated) {
      this.warnedOutdated = true;
      void vscode.window.showWarningMessage("Argus chat is waiting for the previous background process to finish its running chats before it can start. This needs no action.");
    }
  }

  private onFrame(frame: DaemonFrame): void {
    if ("id" in frame) {
      const entry = this.pending.get(frame.id);
      this.pending.delete(frame.id);
      if (frame.ok) {
        entry?.resolve(frame.result);
      } else {
        entry?.reject(new Error(frame.error));
      }
    } else if (frame.event === "log") {
      this.log(frame.line);
    } else {
      this.listeners.get(frame.sessionId)?.event(frame);
    }
  }

  private rejectPending(error: Error): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    entries.forEach((entry) => entry.reject(error));
  }

  private onClose(socket: net.Socket): void {
    if (this.disposed) {
      this.pending.clear();
      return;
    }
    if (socket !== this.socket) {
      this.rejectPending(new ConnectionLostError());
      return;
    }
    this.socket = undefined;
    this.connection = undefined;
    this.rejectPending(new ConnectionLostError());
    this.lostConnection = true;
    if (this.listeners.size > 0) {
      void this.reconnect();
    }
  }

  private async reconnect(): Promise<void> {
    while (!this.disposed) {
      try {
        await this.connect();
        [...this.listeners.values()].forEach((listener) => listener.reopen());
        return;
      } catch (error) {
        this.log(`daemon reconnect: ${describe(error)}`);
        await sleep(RECONNECT_MS);
      }
    }
  }
}
