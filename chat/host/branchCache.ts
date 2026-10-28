// Cards are rebuilt on every board refresh and each lookup spawns git, so remember each folder's branch for a while.
export class BranchCache {
  private readonly entries = new Map<string, { branch?: string; at: number }>();
  private readonly lookup: (folder: string) => string | undefined;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(lookup: (folder: string) => string | undefined, ttlMs = 10_000, now = () => Date.now()) {
    this.lookup = lookup;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  public get(folder: string): string | undefined {
    const hit = this.entries.get(folder);
    if (hit && this.now() - hit.at < this.ttlMs) {
      return hit.branch;
    }
    const branch = this.lookup(folder);
    this.entries.set(folder, { branch, at: this.now() });
    return branch;
  }
}
