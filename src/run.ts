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

export type RunDeps = {
  offers: SourceOffer[];
  ingest: (offer: SourceOffer) => Promise<IngestOutcome>;
  seen: SeenPosts;
  now?: () => Date;
  /** Pause between offers, so the stores are not hit in a burst. */
  delayMs?: number;
  log?: (line: string) => void;
};

/**
 * Sends the unseen, still-valid offers to the destination site, oldest first so the feed keeps their order.
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

  const pending = offers
    .filter((o) => !seen.has(o) && (o.endAt === null || o.endAt.getTime() > now().getTime()))
    .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
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
