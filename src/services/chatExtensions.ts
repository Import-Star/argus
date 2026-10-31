import type { ArgusChatExtension } from "../types";

const ID = /^[a-z0-9-]{1,64}$/;
const MEDIA = new Set(["data:", "blob:"]);

// Backs ArgusApi.registerChatExtension. No vscode import, so it is unit tested.
export class ChatExtensionRegistry {
  private readonly extensions = new Map<string, ArgusChatExtension>();
  private readonly changeListeners = new Set<() => void>();
  private readonly postListeners = new Set<(id: string, message: unknown) => void>();
  private readonly warn: (message: string) => void;

  public constructor(warn: (message: string) => void = (message) => console.warn(message)) {
    this.warn = warn;
  }

  public register(extension: ArgusChatExtension): { dispose(): void; post(message: unknown): void } {
    if (!ID.test(extension.id)) {
      throw new Error(`Argus: invalid chat extension id ${JSON.stringify(extension.id)}.`);
    }
    if (this.extensions.has(extension.id)) {
      throw new Error(`Argus: a chat extension with id "${extension.id}" is already registered.`);
    }
    this.extensions.set(extension.id, extension);
    this.fire();
    return {
      dispose: () => {
        if (this.extensions.get(extension.id) === extension) {
          this.extensions.delete(extension.id);
          this.fire();
        }
      },
      post: (message) => this.postListeners.forEach((listener) => listener(extension.id, message))
    };
  }

  public list(): readonly ArgusChatExtension[] {
    return [...this.extensions.values()];
  }

  // Only data: and blob: can be added to the chat's CSP.
  public media(): string[] {
    return [...new Set(this.list().flatMap((extension) => (extension.media ?? []).filter((source) => MEDIA.has(source))))];
  }

  public onDidChange(listener: () => void): { dispose(): void } {
    this.changeListeners.add(listener);
    return { dispose: () => this.changeListeners.delete(listener) };
  }

  public onDidPost(listener: (id: string, message: unknown) => void): { dispose(): void } {
    this.postListeners.add(listener);
    return { dispose: () => this.postListeners.delete(listener) };
  }

  public async receive(id: string, message: unknown, reply: (message: unknown) => void): Promise<void> {
    try {
      await this.extensions.get(id)?.onMessage?.(message, reply);
    } catch (error) {
      this.warn(`Argus: chat extension "${id}" onMessage threw: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private fire(): void {
    this.changeListeners.forEach((listener) => listener());
  }
}
