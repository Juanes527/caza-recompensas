import { existsSync, readFileSync, writeFileSync } from "node:fs";

import type { SourceOffer } from "./types.ts";

const KEEP_MS = 30 * 86_400_000;

/**
 * Posts already decided, by `source:id`, so a run does not read their store pages again.
 * The destination site still rejects duplicates by itself: this only saves work.
 * A JSON file for now; the Supabase table replaces it when the bot goes to production.
 */
export class SeenPosts {
  private entries: Record<string, string>;
  private readonly path: string;
  private readonly now: () => Date;

  constructor(path: string, now: () => Date = () => new Date()) {
    this.path = path;
    this.now = now;
    this.entries = existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, string>)
      : {};
  }

  private static key(offer: SourceOffer) {
    return `${offer.source}:${offer.sourceId}`;
  }

  has(offer: SourceOffer): boolean {
    return this.hasId(offer.source, offer.sourceId);
  }

  hasId(source: string, sourceId: string): boolean {
    return `${source}:${sourceId}` in this.entries;
  }

  add(offer: SourceOffer) {
    this.entries[SeenPosts.key(offer)] = this.now().toISOString();
  }

  save() {
    const limit = this.now().getTime() - KEEP_MS;
    const fresh = Object.entries(this.entries).filter(([, at]) => new Date(at).getTime() > limit);
    this.entries = Object.fromEntries(fresh);
    writeFileSync(this.path, JSON.stringify(this.entries, null, 1));
  }
}
