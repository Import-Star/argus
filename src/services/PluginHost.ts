import Module = require("module");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { createPluginConfig } from "./PluginConfig";
import { ArgusApi, ArgusPluginContext, ArgusPluginModule, PluginConfig } from "../types";

export const PLUGINS_DIR = path.join(os.homedir(), ".claude", "argus", "plugins");
const MANIFEST = "argus-plugin.json";
const TRUST_KEY = "argus.plugins.trust";
const ID = /^[a-z0-9][a-z0-9-]*$/;
const API_VERSION = 1;

export interface PluginManifest {
  id: string;
  name?: string;
  version?: string;
  main: string;
  apiVersion?: number;
  config?: Record<string, unknown>;
  commands?: { command: string; title: string }[];
}

interface LoadedPlugin {
  manifest: PluginManifest;
  root: string;
  module: ArgusPluginModule;
  context: ArgusPluginContext;
  disposables: vscode.Disposable[];
}

const pluginRoots = new Set<string>();
let interceptorInstalled = false;

function isInside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

// Plugin files live outside any extension folder, so the extension host cannot map them to an extension and hand
// them the vscode module. Resolve it for them, and only for them, so plugin source reads like any extension.
function installVscodeInterceptor(): void {
  if (interceptorInstalled) {
    return;
  }
  interceptorInstalled = true;
  const loader = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const original = loader._load;
  loader._load = function (request: string, parent: unknown, isMain: boolean): unknown {
    if (request === "vscode") {
      const filename = (parent as { filename?: string } | undefined)?.filename;
      if (filename && [...pluginRoots].some((root) => isInside(root, filename))) {
        return vscode;
      }
    }
    return original.call(this, request, parent, isMain);
  };
}

function prefixed(memento: vscode.Memento, pluginId: string): vscode.Memento {
  const full = (key: string) => `plugin.${pluginId}.${key}`;
  return {
    keys: () => memento.keys().filter((key) => key.startsWith(`plugin.${pluginId}.`)),
    get: <T>(key: string, fallback?: T) => (fallback === undefined ? memento.get<T>(full(key)) : memento.get<T>(full(key), fallback)),
    update: (key: string, value: unknown) => memento.update(full(key), value)
  } as vscode.Memento;
}

function readManifest(root: string): PluginManifest {
  const raw = JSON.parse(fs.readFileSync(path.join(root, MANIFEST), "utf8")) as Partial<PluginManifest>;
  if (typeof raw.id !== "string" || !ID.test(raw.id)) {
    throw new Error(`"id" must be lowercase letters, digits and dashes, got ${JSON.stringify(raw.id)}.`);
  }
  if (typeof raw.main !== "string" || !raw.main) {
    throw new Error(`"main" must be the plugin's entry file, relative to ${MANIFEST}.`);
  }
  const apiVersion = raw.apiVersion ?? API_VERSION;
  if (apiVersion > API_VERSION) {
    throw new Error(`needs Argus plugin API ${apiVersion}, this Argus provides ${API_VERSION}. Update Argus.`);
  }
  return { ...raw, id: raw.id, main: raw.main, apiVersion };
}

// Loads plugin folders from ~/.claude/argus/plugins and argus.plugins.paths, and owns their lifetime. A plugin
// that throws is logged and skipped so the rest of Argus keeps working.
export class PluginHost implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel("Argus Plugins");
  private readonly loaded = new Map<string, LoadedPlugin>();

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly api: ArgusApi
  ) {}

  public async load(): Promise<void> {
    installVscodeInterceptor();
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    this.writeTypes();
    for (const root of this.discover()) {
      await this.loadOne(root);
    }
    if (this.loaded.size > 0) {
      this.log(`Loaded ${this.loaded.size} plugin(s): ${[...this.loaded.keys()].join(", ")}.`);
    }
  }

  public async reload(): Promise<void> {
    await this.unload();
    await this.load();
    void vscode.window.showInformationMessage(
      this.loaded.size > 0 ? `Argus: reloaded ${this.loaded.size} plugin(s).` : `Argus: no plugins found in ${PLUGINS_DIR}.`
    );
  }

  public commands(): { command: string; title: string; plugin: string }[] {
    const all: { command: string; title: string; plugin: string }[] = [];
    for (const plugin of this.loaded.values()) {
      for (const entry of plugin.manifest.commands ?? []) {
        if (typeof entry?.command === "string" && typeof entry?.title === "string") {
          all.push({ ...entry, plugin: plugin.manifest.name ?? plugin.manifest.id });
        }
      }
    }
    return all;
  }

  public dispose(): void {
    void this.unload();
    this.output.dispose();
  }

  // Drops this Argus build's API types next to the plugins folder so a plugin can be type-checked against the core
  // it actually runs on, with no package to install.
  private writeTypes(): void {
    for (const [from, to] of [
      ["index.d.ts", "argus.d.ts"],
      ["webview.d.ts", "argus-webview.d.ts"]
    ]) {
      try {
        fs.copyFileSync(path.join(this.context.extensionPath, "api", from), path.join(PLUGINS_DIR, to));
      } catch (error) {
        this.log(`Could not write ${to}: ${message(error)}`);
      }
    }
  }

  private discover(): string[] {
    const roots: string[] = [];
    for (const entry of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        roots.push(path.join(PLUGINS_DIR, entry.name));
      }
    }
    // A configured path is someone's deliberate choice, so say so when it holds no plugin.
    for (const entry of vscode.workspace.getConfiguration("argus.plugins").get<string[]>("paths", [])) {
      if (typeof entry !== "string" || !entry.trim()) {
        continue;
      }
      const root = path.resolve(entry.trim().replace(/^~(?=$|[/\\])/, os.homedir()));
      if (!fs.existsSync(path.join(root, MANIFEST))) {
        this.log(`argus.plugins.paths entry "${entry}" has no ${MANIFEST}.`);
        continue;
      }
      roots.push(root);
    }
    // Through the real path, because require.cache is keyed by it and a plugin folder is often a symlink to a checkout.
    return roots.filter((root) => fs.existsSync(path.join(root, MANIFEST))).map((root) => fs.realpathSync(root));
  }

  private async loadOne(root: string): Promise<void> {
    let manifest: PluginManifest;
    try {
      manifest = readManifest(root);
    } catch (error) {
      this.log(`Skipped ${root}: ${message(error)}`);
      return;
    }
    if (this.loaded.has(manifest.id)) {
      this.log(`Skipped ${root}: plugin id "${manifest.id}" is already loaded from ${this.loaded.get(manifest.id)?.root}.`);
      return;
    }
    if (!(await this.isTrusted(root, manifest))) {
      return;
    }

    const main = path.resolve(root, manifest.main);
    if (!isInside(root, main)) {
      this.log(`Skipped ${root}: "main" points outside the plugin folder.`);
      return;
    }

    pluginRoots.add(root);
    const disposables: vscode.Disposable[] = [];
    try {
      const module = require(main) as ArgusPluginModule;
      if (typeof module?.activate !== "function") {
        throw new Error(`${manifest.main} does not export activate().`);
      }
      const context = this.makeContext(manifest, root, disposables);
      await module.activate(this.api, context);
      this.loaded.set(manifest.id, { manifest, root, module, context, disposables });
    } catch (error) {
      pluginRoots.delete(root);
      clearRequireCache(root);
      for (const disposable of disposables) {
        safely(() => disposable.dispose());
      }
      this.log(`Plugin "${manifest.id}" failed to activate: ${message(error)}`);
      void vscode.window.showErrorMessage(`Argus: plugin "${manifest.id}" failed to load. See the Argus Plugins output channel.`);
    }
  }

  private makeContext(manifest: PluginManifest, root: string, disposables: vscode.Disposable[]): ArgusPluginContext {
    const storage = vscode.Uri.joinPath(this.context.globalStorageUri, "plugins", manifest.id);
    fs.mkdirSync(storage.fsPath, { recursive: true });
    const config: PluginConfig = createPluginConfig(manifest.id, manifest.config ?? {}, disposables);
    return {
      pluginId: manifest.id,
      subscriptions: disposables,
      extensionUri: vscode.Uri.file(root),
      extensionPath: root,
      globalStorageUri: storage,
      globalState: prefixed(this.context.globalState, manifest.id),
      workspaceState: prefixed(this.context.workspaceState, manifest.id),
      config
    };
  }

  private async unload(): Promise<void> {
    for (const plugin of [...this.loaded.values()].reverse()) {
      if (typeof plugin.module.deactivate === "function") {
        await safelyAsync(() => plugin.module.deactivate?.());
      }
      for (const disposable of [...plugin.disposables].reverse()) {
        safely(() => disposable.dispose());
      }
      pluginRoots.delete(plugin.root);
      clearRequireCache(plugin.root);
    }
    this.loaded.clear();
  }

  // Asked once per folder; the answer is remembered because loading a plugin runs its code with Argus's own access
  // to this machine.
  private async isTrusted(root: string, manifest: PluginManifest): Promise<boolean> {
    const trust = this.context.globalState.get<Record<string, boolean>>(TRUST_KEY, {});
    if (typeof trust[root] === "boolean") {
      if (!trust[root]) {
        this.log(`Skipped ${root}: not trusted. Run "Argus: Reset Plugin Trust" to be asked again.`);
      }
      return trust[root];
    }
    const name = manifest.name ?? manifest.id;
    const choice = await vscode.window.showWarningMessage(
      `Argus found the plugin "${name}" in ${root}. Loading it runs its code with the same access Argus has to this machine. Load it?`,
      { modal: true },
      "Load",
      "Skip"
    );
    const allowed = choice === "Load";
    await this.context.globalState.update(TRUST_KEY, { ...trust, [root]: allowed });
    return allowed;
  }

  public async resetTrust(): Promise<void> {
    await this.context.globalState.update(TRUST_KEY, {});
    await this.reload();
  }

  private log(line: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${line}`);
  }
}

function clearRequireCache(root: string): void {
  for (const key of Object.keys(require.cache)) {
    if (isInside(root, key)) {
      delete require.cache[key];
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function safely(run: () => void): void {
  try {
    run();
  } catch {
    // A plugin that throws on the way out must not stop the others being torn down.
  }
}

async function safelyAsync(run: () => unknown): Promise<void> {
  try {
    await run();
  } catch {
    // Same as safely, for an async deactivate().
  }
}
