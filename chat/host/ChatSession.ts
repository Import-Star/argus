import { getSessionMessages, query, type PermissionResult, type PermissionUpdate, type Query, type RewindFilesResult, type SDKMessage, type SDKUserMessage, type SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { MessageQueue, type QueueAction } from "./messageQueue";
import type { ChatMeta, ChatStatus, EffortLevel, HostMessage, PermissionDecision, PermissionMode, PermissionRequest, QueuedMessage } from "../../src/chat/protocol";

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
  log(line: string): void;
}

class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiting?: (result: IteratorResult<SDKUserMessage>) => void;
  private closed = false;

  push(item: SDKUserMessage): void {
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = undefined;
      resolve({ value: item, done: false });
    } else {
      this.items.push(item);
    }
  }

  close(): void {
    this.closed = true;
    this.waiting?.({ value: undefined, done: true });
    this.waiting = undefined;
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) {
          return Promise.resolve({ value: item, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve) => (this.waiting = resolve));
      }
    };
  }
}

const FIVE_MINUTES = 5 * 60_000;
const ONE_HOUR = 60 * 60_000;

function parseTtl(value: unknown): number | undefined {
  return value === "5m" ? FIVE_MINUTES : value === "1h" ? ONE_HOUR : undefined;
}

function readSettings(file: string): { promptCacheTtl?: unknown; env?: Record<string, unknown> } {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

// Settings and env beat the account default, in the order the CLI reads them (local over project over user).
function configuredCacheTtl(cwd: string): number | undefined {
  const files = [path.join(cwd, ".claude", "settings.local.json"), path.join(cwd, ".claude", "settings.json"), path.join(os.homedir(), ".claude", "settings.json")];
  const settings = files.map(readSettings);
  const fromEnv = parseTtl(process.env.CLAUDE_CODE_PROMPT_CACHE_TTL) ?? settings.map((entry) => parseTtl(entry.env?.CLAUDE_CODE_PROMPT_CACHE_TTL)).find((ttl) => ttl);
  return fromEnv ?? settings.map((entry) => parseTtl(entry.promptCacheTtl)).find((ttl) => ttl);
}

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

interface Pending {
  request: PermissionRequest;
  suggestions?: PermissionUpdate[];
  resolve(result: PermissionResult): void;
}

function alwaysLabel(suggestions: PermissionUpdate[] | undefined): string | undefined {
  const labels = (suggestions ?? []).flatMap((update) => {
    if (update.type === "addRules") {
      return update.rules.map((rule) => (rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : rule.toolName));
    }
    return update.type === "setMode" ? [`switch to ${update.mode}`] : [];
  });
  return labels.length > 0 ? labels.join(", ") : undefined;
}

export class ChatSession implements vscode.Disposable {
  public readonly sessionId: string;
  public meta: ChatMeta;
  private readonly emitter = new vscode.EventEmitter<HostMessage>();
  public readonly onMessage = this.emitter.event;
  private input = new InputQueue();
  private readonly pending = new Map<string, Pending>();
  private q?: Query;
  private historyLoaded?: Promise<SDKMessage[]>;
  private aliases = new Map<string, string>();
  private turnFiles = new Set<string>();
  private readonly queue = new MessageQueue({
    submit: (entry) => this.input.push(this.userMessage(entry.uuid, entry.text, entry.images)),
    cancel: (uuid) => this.cancelQueued(uuid),
    interrupt: () => this.interrupt().catch((error) => this.options.log(`interrupt ${this.sessionId}: ${error instanceof Error ? error.message : String(error)}`)),
    started: (entry) => this.emitter.fire({ type: "sdk", sessionId: this.sessionId, message: this.userMessage(entry.uuid, entry.text, entry.images) }),
    changed: (items) => this.emitter.fire({ type: "queue", sessionId: this.sessionId, items })
  });

  constructor(private readonly options: ChatSessionOptions) {
    this.sessionId = options.sessionId ?? randomUUID();
    this.meta = {
      sessionId: this.sessionId,
      cwd: options.cwd,
      title: options.title,
      status: "starting",
      statusSince: Date.now(),
      model: options.model ?? "default",
      effort: options.effort,
      permissionMode: options.permissionMode,
      models: []
    };
  }

  public start(resumeAt?: string): void {
    if (this.q) {
      return;
    }
    const { cwd, resume, claudePath, additionalDirectories, model, effort, permissionMode, log } = this.options;
    this.q = query({
      prompt: this.input,
      options: {
        cwd,
        additionalDirectories,
        resume: resume ? this.sessionId : undefined,
        resumeSessionAt: resumeAt,
        enableFileCheckpointing: true,
        sessionId: resume ? undefined : this.sessionId,
        model,
        effort,
        permissionMode,
        pathToClaudeCodeExecutable: claudePath,
        // SDK sessions leave the to-do tools off; the transcript's to-do card needs them.
        // Under the SDK's default "sdk-ts" entrypoint the CLI turns the Artifact tools off; the to-do tools are off by default too.
        env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "claude-vscode", CLAUDE_CODE_ENABLE_TODO_TOOLS: "1", CLAUDE_CODE_ENABLE_TASKS: "1" },
        includePartialMessages: true,
        canUseTool: (toolName, input, { signal, suggestions, decisionReason, blockedPath, toolUseID }) =>
          this.ask({ toolName, input, suggestions, decisionReason, blockedPath, toolUseId: toolUseID, signal }),
        stderr: (data) => log(`[${this.sessionId}] ${data.trimEnd()}`)
      }
    });
    void this.pump(this.q);
    void this.loadModels(this.q);
    void this.loadCommands(this.q);
    void this.loadCacheTtl(this.q);
  }

  public get activeQuery(): Query | undefined {
    return this.q;
  }

  public history(): Promise<SDKMessage[]> {
    if (!this.options.resume) {
      return Promise.resolve([]);
    }
    this.historyLoaded ??= getSessionMessages(this.sessionId, { dir: this.options.cwd })
      .then((messages) => {
        this.restoreLastResponse(messages as unknown as { type: string; parent_tool_use_id?: string | null; timestamp?: string }[]);
        return messages as unknown as SDKMessage[];
      })
      .catch((error) => {
        this.options.log(`history ${this.sessionId}: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      });
    return this.historyLoaded;
  }

  public lastTurnFiles(): string[] {
    return [...this.turnFiles];
  }

  public pendingRequests(): PermissionRequest[] {
    return [...this.pending.values()].map((entry) => entry.request);
  }

  public send(text: string, images: { mediaType: string; data: string }[] = []): void {
    this.start();
    if (this.meta.status === "working" || this.meta.status === "needs-you") {
      this.queue.add(text, images);
      return;
    }
    this.turnFiles = new Set();
    const message = this.userMessage(randomUUID(), text, images);
    this.input.push(message);
    // The SDK doesn't echo prompts back, so the transcript gets them from here.
    this.emitter.fire({ type: "sdk", sessionId: this.sessionId, message });
    this.setStatus("working");
  }

  public queued(): QueuedMessage[] {
    return this.queue.items();
  }

  public queueAction(id: string, action: QueueAction, text?: string): void {
    this.queue.act(id, action, text);
  }

  private userMessage(uuid: string, text: string, images: { mediaType: string; data: string }[]): SDKUserMessage {
    const content = [
      ...images.map((image) => ({ type: "image" as const, source: { type: "base64" as const, media_type: image.mediaType, data: image.data } })),
      { type: "text" as const, text }
    ];
    return {
      type: "user",
      uuid,
      session_id: this.sessionId,
      message: { role: "user", content: images.length > 0 ? content : text },
      parent_tool_use_id: null,
      origin: { kind: "human" }
    } as SDKUserMessage;
  }

  // cancelAsyncMessage and command_lifecycle exist in the SDK runtime but not in sdk.d.ts.
  private async cancelQueued(uuid: string): Promise<boolean> {
    try {
      const q = this.q as (Query & { cancelAsyncMessage?(uuid: string): Promise<boolean> }) | undefined;
      return (await q?.cancelAsyncMessage?.(uuid)) === true;
    } catch {
      return false;
    }
  }

  private trackLifecycle(message: SDKMessage): boolean {
    const event = message as unknown as { type: string; command_uuid?: string; state?: string };
    if (event.type !== "command_lifecycle") {
      return false;
    }
    if (event.command_uuid && event.state) {
      this.queue.onLifecycle(event.command_uuid, event.state);
    }
    return true;
  }

  public async interrupt(): Promise<void> {
    await this.q?.interrupt();
  }

  public async setModel(model: string): Promise<void> {
    this.start();
    await this.q?.setModel(model);
    this.update({ model });
  }

  public async setEffort(effort: EffortLevel): Promise<void> {
    this.start();
    await this.q?.applyFlagSettings({ effortLevel: effort });
    this.update({ effort });
  }

  // Saved through the CLI's own settings writer, the same way /effort does. Settings files have no "max" level.
  public async saveEffortDefault(effort: EffortLevel): Promise<void> {
    if (effort !== "max") {
      await this.q?.updateSettings("userSettings", { effortLevel: effort });
    }
  }

  public async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.start();
    await this.q?.setPermissionMode(mode);
    this.update({ permissionMode: mode });
  }

  public async stopTask(taskId: string): Promise<void> {
    await this.q?.stopTask(taskId);
  }

  public async rewindFiles(userMessageId: string, dryRun: boolean): Promise<RewindFilesResult> {
    this.start();
    return this.q!.rewindFiles(userMessageId, { dryRun });
  }

  // Restarts the CLI on the same session, resumed only up to `at`; the SDK has no in-place truncate.
  public async truncateTo(at: string, userMessageId: string, text: string): Promise<void> {
    const old = this.q;
    this.q = undefined;
    this.input.close();
    this.input = new InputQueue();
    old?.close();
    this.queue.clear();
    this.options.resume = true;
    this.historyLoaded = getSessionMessages(this.sessionId, { dir: this.options.cwd })
      .then((chain) => chain.slice(0, chain.findIndex((entry) => entry.uuid === at) + 1) as unknown as SDKMessage[])
      .catch(() => []);
    this.start(at);
    this.emitter.fire({ type: "rewound", sessionId: this.sessionId, userMessageId, text });
    this.setStatus("idle");
  }

  public respond(id: string, decision: PermissionDecision): void {
    const entry = this.pending.get(id);
    if (!entry) {
      return;
    }
    this.pending.delete(id);
    entry.resolve(
      decision.behavior === "allow"
        ? {
            behavior: "allow",
            updatedInput: decision.updatedInput ?? entry.request.input,
            updatedPermissions: decision.always ? entry.suggestions : undefined
          }
        : { behavior: "deny", message: decision.message }
    );
    this.emitter.fire({ type: "permissionResolved", sessionId: this.sessionId, id });
    this.setStatus(this.pending.size > 0 ? "needs-you" : "working");
  }

  public fillComposer(text: string): void {
    this.emitter.fire({ type: "draft", sessionId: this.sessionId, text });
  }

  public rename(title: string): void {
    this.update({ title });
  }

  public dispose(): void {
    for (const id of [...this.pending.keys()]) {
      this.respond(id, { behavior: "deny", message: "The chat was closed." });
    }
    this.input.close();
    this.q?.close();
    this.emitter.dispose();
  }

  private ask(args: {
    toolName: string;
    input: Record<string, unknown>;
    suggestions?: PermissionUpdate[];
    decisionReason?: string;
    blockedPath?: string;
    toolUseId?: string;
    signal: AbortSignal;
  }): Promise<PermissionResult> {
    const request: PermissionRequest = {
      id: randomUUID(),
      toolName: args.toolName,
      toolUseId: args.toolUseId,
      input: args.input,
      decisionReason: args.decisionReason,
      blockedPath: args.blockedPath,
      alwaysLabel: alwaysLabel(args.suggestions),
      createdAt: Date.now()
    };
    return new Promise((resolve) => {
      this.pending.set(request.id, { request, suggestions: args.suggestions, resolve });
      args.signal.addEventListener("abort", () => {
        if (this.pending.delete(request.id)) {
          resolve({ behavior: "deny", message: "Cancelled." });
          this.emitter.fire({ type: "permissionResolved", sessionId: this.sessionId, id: request.id });
        }
      });
      this.emitter.fire({ type: "permission", sessionId: this.sessionId, request });
      this.setStatus("needs-you");
    });
  }

  private async pump(q: Query): Promise<void> {
    try {
      for await (const message of q) {
        if (q !== this.q) {
          return;
        }
        if (this.trackLifecycle(message)) {
          continue;
        }
        this.track(message);
        this.emitter.fire({ type: "sdk", sessionId: this.sessionId, message });
      }
      if (q === this.q) {
        this.queue.clear();
        this.setStatus("ended");
      }
    } catch (error) {
      if (q !== this.q) {
        return;
      }
      const text = error instanceof Error ? error.message : String(error);
      this.options.log(`session ${this.sessionId}: ${text}`);
      this.update({ error: text });
      this.queue.clear();
      this.setStatus("error");
    }
  }

  private track(message: SDKMessage): void {
    if (message.type === "assistant") {
      this.trackEdits(message.message.content);
      this.markResponse(message.parent_tool_use_id);
    } else if (message.type === "system" && message.subtype === "init") {
      this.update({ model: this.modelValue(message.model), permissionMode: message.permissionMode });
    } else if (message.type === "system" && message.subtype === "commands_changed") {
      this.setCommands(message.commands);
    } else if (message.type === "system" && message.subtype === "session_state_changed") {
      const status: ChatStatus = message.state === "running" ? "working" : message.state === "requires_action" ? "needs-you" : "idle";
      this.setStatus(this.pending.size > 0 ? "needs-you" : status);
    } else if (message.type === "result") {
      this.markResponse(null);
      this.queue.turnEnded();
      this.setStatus(this.pending.size > 0 ? "needs-you" : "idle");
      void this.loadContext();
    }
  }

  private trackEdits(content: unknown): void {
    for (const block of Array.isArray(content) ? (content as { type: string; name?: string; input?: Record<string, unknown> }[]) : []) {
      const file = block.type === "tool_use" && EDIT_TOOLS.has(block.name ?? "") ? (block.input?.file_path ?? block.input?.notebook_path) : undefined;
      if (typeof file === "string") {
        this.turnFiles.add(path.resolve(this.options.cwd, file));
      }
    }
  }

  private async loadCommands(q: Query): Promise<void> {
    try {
      this.setCommands(await q.supportedCommands());
    } catch (error) {
      this.options.log(`commands ${this.sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private setCommands(commands: SlashCommand[]): void {
    this.update({ commands: commands.map(({ name, description, argumentHint }) => ({ name, description, argumentHint })) });
  }

  private async loadModels(q: Query): Promise<void> {
    try {
      const models = await q.supportedModels();
      // init reports the full model id ("claude-haiku-5-5"); the picker lists aliases ("haiku").
      for (const model of models) {
        if (model.resolvedModel && model.value !== "default" && !this.aliases.has(model.resolvedModel)) {
          this.aliases.set(model.resolvedModel, model.value);
        }
      }
      this.update({
        models: models.map((model) => ({ value: model.value, displayName: model.displayName, efforts: model.supportedEffortLevels ?? [] })),
        model: this.meta.model && this.modelValue(this.meta.model)
      });
      if (this.meta.status === "starting") {
        this.setStatus("idle");
      }
    } catch (error) {
      this.options.log(`models ${this.sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // A reopened chat has no live reply yet, so the cache countdown starts from the transcript's last reply.
  private restoreLastResponse(messages: { type: string; parent_tool_use_id?: string | null; timestamp?: string }[]): void {
    const last = [...messages].reverse().find((message) => message.type === "assistant" && !message.parent_tool_use_id && message.timestamp);
    const at = last?.timestamp ? Date.parse(last.timestamp) : NaN;
    if (!Number.isNaN(at) && (this.meta.lastResponseAt ?? 0) < at) {
      this.update({ lastResponseAt: at });
    }
  }

  private markResponse(parentToolUseId: string | null): void {
    if (!parentToolUseId) {
      this.update({ lastResponseAt: Date.now() });
    }
  }

  private async loadCacheTtl(q: Query): Promise<void> {
    try {
      const account = await q.accountInfo();
      const subscription = Boolean(account.subscriptionType) && (account.apiProvider ?? "firstParty") === "firstParty";
      this.update({ cacheTtlMs: configuredCacheTtl(this.options.cwd) ?? (subscription ? ONE_HOUR : FIVE_MINUTES) });
    } catch (error) {
      this.options.log(`account ${this.sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private modelValue(model: string): string {
    return this.aliases.get(model) ?? model;
  }

  private async loadContext(): Promise<void> {
    try {
      const usage = await this.q?.getContextUsage({ detail: "summary" });
      if (usage) {
        this.update({ contextTokens: usage.totalTokens, contextMax: usage.maxTokens });
      }
    } catch {
      // Older CLIs don't answer this; the header just hides the meter.
    }
  }

  private setStatus(status: ChatStatus): void {
    if (status !== this.meta.status) {
      this.update({ status, statusSince: Date.now() });
    }
  }

  private update(patch: Partial<ChatMeta>): void {
    this.meta = { ...this.meta, ...patch };
    this.emitter.fire({ type: "meta", meta: this.meta });
  }
}
