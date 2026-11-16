import type { Query, RewindFilesResult, SDKMessage, SessionCronSummary } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "crypto";
import * as vscode from "vscode";
import type { DaemonFrame, OpenOptions, SessionMethod, SessionState } from "../../src/chat/daemonProtocol";
import type { Panel } from "../../src/chat/panels";
import type { McpStatus } from "../../src/chat/panels/mcp";
import type { ChatMeta, EffortLevel, HostMessage, PermissionDecision, PermissionMode, PermissionRequest, PlanUsage, QueuedMessage, ShellRun } from "../../src/chat/protocol";
import { ConnectionLostError, type DaemonClient } from "./daemonClient";
import type { QueueAction } from "./messageQueue";
import { refreshPanel } from "./panels";

export interface ChatSessionOptions {
  sessionId?: string;
  cwd: string;
  resume: boolean;
  title?: string;
  claudePath?: string;
  additionalDirectories: string[];
  model?: string;
  effort?: EffortLevel;
  permissionMode: PermissionMode;
  textOnly: boolean;
  // Claude in Chrome; unset leaves the CLI's default.
  chrome?: boolean;
  color?: string;
  // Turn Remote Control on whenever the process starts (Claude Code's remoteControlAtStartup).
  remoteControlAtStartup?: boolean;
  planUsage(): PlanUsage | null | undefined;
  log(line: string): void;
}

export interface SessionSettings {
  effective: Record<string, unknown>;
  effort?: string | null;
  advisor?: string | null;
  ultracode?: boolean;
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

// This window's view of a session that runs in the background process; its state is mirrored from there.
export class ChatSession implements vscode.Disposable {
  public readonly sessionId: string;
  private readonly emitter = new vscode.EventEmitter<HostMessage>();
  public readonly onMessage = this.emitter.event;
  private state: SessionState;
  private opened?: Promise<void>;
  private readonly query = new Proxy(
    {},
    {
      // A thenable would make `await session.activeQuery` wait on it forever.
      get: (_, method) => (typeof method === "string" && method !== "then" ? (...args: unknown[]) => this.client.request({ op: "query", sessionId: this.sessionId, method, args }) : undefined)
    }
  ) as unknown as Query;
  public readonly shell = {
    items: (): ShellRun[] => this.state.shellRuns,
    run: (command: string): void => this.fire({ op: "shell", sessionId: this.sessionId, method: "run", args: [command] }, "shell run"),
    act: (id: string, action: "stop" | "background"): void => this.fire({ op: "shell", sessionId: this.sessionId, method: "act", args: [id, action] }, "shell act")
  };

  constructor(private readonly client: DaemonClient, private readonly options: ChatSessionOptions) {
    this.sessionId = options.sessionId ?? randomUUID();
    const now = Date.now();
    this.state = {
      meta: {
        sessionId: this.sessionId,
        cwd: options.cwd,
        title: options.title,
        status: "starting",
        statusSince: now,
        model: options.model ?? "default",
        textOnly: options.textOnly,
        effort: options.effort,
        permissionMode: options.permissionMode,
        chrome: options.chrome,
        color: options.color,
        models: []
      },
      processStartedAt: now,
      claudePath: options.claudePath,
      additionalDirectories: options.additionalDirectories,
      runningBackgroundTasks: 0,
      stoppable: false,
      pendingRequests: [],
      queued: [],
      lastTurnFiles: [],
      shellRuns: [],
      hasQuery: false
    };
  }

  public get meta(): ChatMeta {
    return this.state.meta;
  }

  public get processStartedAt(): number {
    return this.state.processStartedAt;
  }

  public get sessionCrons(): SessionCronSummary[] | undefined {
    return this.state.sessionCrons;
  }

  public get claudePath(): string | undefined {
    return this.state.claudePath;
  }

  public get additionalDirectories(): string[] {
    return [...this.state.additionalDirectories];
  }

  public get busy(): boolean {
    return this.meta.status === "working" || this.meta.status === "needs-you";
  }

  public get runningBackgroundTasks(): number {
    return this.state.runningBackgroundTasks;
  }

  public get stoppable(): boolean {
    return this.state.stoppable;
  }

  public get activeQuery(): Query | undefined {
    return this.state.hasQuery ? this.query : undefined;
  }

  public lastTurnFiles(): string[] {
    return [...this.state.lastTurnFiles];
  }

  public pendingRequests(): PermissionRequest[] {
    return [...this.state.pendingRequests];
  }

  public queued(): QueuedMessage[] {
    return [...this.state.queued];
  }

  public planUsage(): PlanUsage | null | undefined {
    return this.options.planUsage();
  }

  public start(): void {
    this.client.attach(this.sessionId, { event: (frame) => this.onEvent(frame), reopen: () => this.reopen() });
    this.opened ??= this.open(this.options.resume);
  }

  public async history(): Promise<SDKMessage[]> {
    await this.opened;
    return this.call("history");
  }

  public setRemoteControl(enabled: boolean): Promise<string | undefined> {
    return this.call("setRemoteControl", enabled);
  }

  public chromeBrowsers(): Promise<{ id: string; name: string; platform?: string; current: boolean }[]> {
    return this.call("chromeBrowsers");
  }

  public selectChromeBrowser(id: string): Promise<void> {
    return this.call("selectChromeBrowser", id);
  }

  public setChrome(enabled: boolean): void {
    this.fireCall("setChrome", enabled);
  }

  public addDirectory(folder: string): void {
    this.fireCall("addDirectory", folder);
  }

  public send(prompt: string, images: { mediaType: string; data: string }[] = []): void {
    this.fireCall("send", prompt, images);
  }

  public queueAction(id: string, action: QueueAction, text?: string): void {
    this.fireCall("queueAction", id, action, text);
  }

  public interrupt(): Promise<void> {
    return this.call("interrupt");
  }

  public setModel(model: string): Promise<void> {
    return this.call("setModel", model);
  }

  public setEffort(effort: EffortLevel): Promise<void> {
    return this.call("setEffort", effort);
  }

  public saveEffortDefault(effort: EffortLevel): Promise<void> {
    return this.call("saveEffortDefault", effort);
  }

  public setColor(color: string | undefined): void {
    this.fireCall("setColor", color);
  }

  public clearEffort(): void {
    this.fireCall("clearEffort");
  }

  public initInfo(): Promise<{ outputStyle: string; outputStyles: string[] }> {
    return this.call("initInfo");
  }

  public settings(): Promise<SessionSettings> {
    return this.call("settings");
  }

  public setPermissionMode(mode: PermissionMode): Promise<void> {
    return this.call("setPermissionMode", mode);
  }

  public stopTask(taskId: string): Promise<void> {
    return this.call("stopTask", taskId);
  }

  public rewindFiles(userMessageId: string, dryRun: boolean): Promise<RewindFilesResult> {
    return this.call("rewindFiles", userMessageId, dryRun);
  }

  public relaunch(): void {
    this.fireCall("relaunch");
  }

  public truncateTo(at: string, userMessageId: string, text: string): Promise<void> {
    return this.call("truncateTo", at, userMessageId, text);
  }

  public respond(id: string, decision: PermissionDecision): void {
    this.fireCall("respond", id, decision);
  }

  public rename(title: string): void {
    this.fireCall("rename", title);
  }

  public syncName(name: string): void {
    this.fireCall("syncName", name);
  }

  public setMcpServers(servers: readonly { status: McpStatus }[]): void {
    this.fireCall("setMcpServers", servers);
  }

  public showPanel(panel: Panel, refresh = false): void {
    this.emitter.fire({ type: "panel", sessionId: this.sessionId, panel, refresh });
  }

  public showPlan(): void {
    this.emitter.fire({ type: "openPlan", sessionId: this.sessionId });
  }

  public fillComposer(text: string): void {
    this.emitter.fire({ type: "draft", sessionId: this.sessionId, text });
  }

  // Closes this window's view only; the agent keeps running until the background process's idle rule stops it.
  public dispose(): void {
    this.release();
    this.client.request({ op: "detach", sessionId: this.sessionId }).catch((error) => this.options.log(`detach ${this.sessionId}: ${describe(error)}`));
  }

  // Ends the agent in every window.
  public async stop(): Promise<void> {
    this.release();
    await this.client.request({ op: "stop", sessionId: this.sessionId }).catch((error) => this.options.log(`stop ${this.sessionId}: ${describe(error)}`));
  }

  private release(): void {
    this.client.detach(this.sessionId);
    this.emitter.dispose();
  }

  private call<T>(method: SessionMethod, ...args: unknown[]): Promise<T> {
    return this.client.request<T>({ op: "call", sessionId: this.sessionId, method, args });
  }

  private fireCall(method: SessionMethod, ...args: unknown[]): void {
    this.call(method, ...args).catch((error) => this.options.log(`${method} ${this.sessionId}: ${describe(error)}`));
  }

  private fire(request: Parameters<DaemonClient["request"]>[0], what: string): void {
    this.client.request(request).catch((error) => this.options.log(`${what} ${this.sessionId}: ${describe(error)}`));
  }

  private openOptions(resume: boolean): OpenOptions {
    const { planUsage, log, ...rest } = this.options;
    const { meta, additionalDirectories, claudePath } = this.state;
    const config = vscode.workspace.getConfiguration("argus.chat");
    return {
      ...rest,
      sessionId: this.sessionId,
      resume,
      title: meta.title,
      claudePath,
      additionalDirectories,
      model: meta.model === "default" ? undefined : meta.model,
      effort: meta.effort,
      permissionMode: meta.permissionMode,
      chrome: meta.chrome,
      color: meta.color,
      hiddenModels: config.get<string[]>("hiddenModels", []),
      idleMinutes: config.get<number>("backgroundIdleMinutes", 60),
      env: process.env
    };
  }

  private async open(resume: boolean): Promise<void> {
    try {
      this.state = await this.client.request<SessionState>({ op: "open", options: this.openOptions(resume) });
      this.emitter.fire({ type: "meta", meta: this.meta });
      this.emitter.fire({ type: "queue", sessionId: this.sessionId, items: this.state.queued });
      this.emitter.fire({ type: "shells", sessionId: this.sessionId, runs: this.state.shellRuns });
    } catch (error) {
      if (error instanceof ConnectionLostError) {
        return;
      }
      this.options.log(`open ${this.sessionId}: ${describe(error)}`);
      this.state = { ...this.state, meta: { ...this.meta, status: "error", statusSince: Date.now() } };
      this.emitter.fire({ type: "meta", meta: this.meta });
    }
  }

  private reopen(): void {
    this.opened = this.open(true);
  }

  private onEvent(frame: Extract<DaemonFrame, { sessionId: string }>): void {
    if (frame.event === "message") {
      if (frame.state) {
        this.state = frame.state;
      }
      this.emitter.fire(frame.message);
    } else if (frame.event === "refreshPanel") {
      void refreshPanel(this, frame.kind);
    } else {
      this.state = { ...this.state, meta: { ...this.meta, status: "ended", statusSince: Date.now() } };
      this.emitter.fire({ type: "meta", meta: this.meta });
    }
  }
}
