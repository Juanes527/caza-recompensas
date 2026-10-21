import type { IngestOutcome } from "./destination.ts";
import type { SeenPosts } from "./state.ts";
import type { SourceOffer } from "./types.ts";

export type RunSummary = {
  read: number;
  skipped: number;
  published: number;
  duplicates: number;
  rejected: Record<string, number>;
  retry: number;
  /** Why the run stopped early, if it did. */
  stopped: "capped" | "fatal" | null;
  detail: string | null;
};

/** The posts worth sending now: unseen, not ended, recent; the newest `limit`, oldest first. */
export function selectOffers(
  offers: SourceOffer[],
  options: { seen: SeenPosts; now: Date; maxAgeMs?: number; limit?: number },
): SourceOffer[] {
  const { seen, now, maxAgeMs, limit } = options;
  const fresh = offers
    .filter((o) => !seen.has(o))
    .filter((o) => o.endAt === null || o.endAt.getTime() > now.getTime())
    .filter((o) => maxAgeMs === undefined || now.getTime() - o.publishedAt.getTime() <= maxAgeMs)
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  return fresh.slice(0, limit ?? fresh.length).reverse();
}

export type RunDeps = {
  offers: SourceOffer[];
  ingest: (offer: SourceOffer) => Promise<IngestOutcome>;
  seen: SeenPosts;
  now?: () => Date;
  /** Only posts at most this old (ms). */
  maxAgeMs?: number;
  /** At most this many posts per run: the newest ones. */
  limit?: number;
  /** Pause between offers, so the stores are not hit in a burst. */
  delayMs?: number;
  log?: (line: string) => void;
};

/**
 * Sends the selected offers (see selectOffers) to the destination site, oldest first so the feed keeps their order.
 * A post is remembered once the destination site has decided it (published, duplicate or rejected for good);
 * a failure that may pass (server or network trouble) is retried next run.
 */
export async function runOnce(deps: RunDeps): Promise<RunSummary> {
  const { offers, ingest, seen, now = () => new Date(), delayMs = 0, log = () => {} } = deps;
  const summary: RunSummary = {
    read: offers.length,
    skipped: 0,
    published: 0,
    duplicates: 0,
    rejected: {},
    retry: 0,
    stopped: null,
    detail: null,
  };

  const pending = selectOffers(offers, {
    seen,
    now: now(),
    maxAgeMs: deps.maxAgeMs,
    limit: deps.limit,
  });
  summary.skipped = offers.length - pending.length;

  for (const offer of pending) {
    const outcome = await ingest(offer);
    log(`#${offer.sourceId} ${offer.title.slice(0, 50)} -> ${outcome.kind}`);

    if (outcome.kind === "capped" || outcome.kind === "fatal") {
      summary.stopped = outcome.kind;
      summary.detail = outcome.kind === "fatal" ? outcome.detail : null;
      break;
    }
    if (outcome.kind === "retry") {
      summary.retry += 1;
      summary.detail = outcome.detail;
    } else {
      seen.add(offer);
      if (outcome.kind === "published") summary.published += 1;
      else if (outcome.kind === "duplicate") summary.duplicates += 1;
      else summary.rejected[outcome.reason] = (summary.rejected[outcome.reason] ?? 0) + 1;
    }
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return summary;
}
