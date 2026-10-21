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
  stopped: "capped" | "fatal" | "budget" | null;
  detail: string | null;
};

/** The posts worth sending now: unseen, not ended and recent, oldest first. */
export function selectOffers(
  offers: SourceOffer[],
  options: { seen: SeenPosts; now: Date; maxAgeMs?: number },
): SourceOffer[] {
  const { seen, now, maxAgeMs } = options;
  return offers
    .filter((o) => !seen.has(o))
    .filter((o) => o.endAt === null || o.endAt.getTime() > now.getTime())
    .filter((o) => maxAgeMs === undefined || now.getTime() - o.publishedAt.getTime() <= maxAgeMs)
    .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
}

export type RunDeps = {
  offers: SourceOffer[];
  ingest: (offer: SourceOffer) => Promise<IngestOutcome>;
  seen: SeenPosts;
  now?: () => Date;
  /** Only posts at most this old (ms). */
  maxAgeMs?: number;
  /** Queue: wait this long (ms) after each published offer before the next one. */
  gapMs?: number;
  /** Short pause (ms) after an offer that was not published, so the stores are not hit in a burst. */
  politeMs?: number;
  /** Epoch ms after which no new offer is started; the rest waits for the next run. */
  deadline?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
};

/**
 * Sends the selected offers (see selectOffers) to the destination site, oldest first so the feed
 * keeps their order, as a queue: after each published offer it waits `gapMs`.
 * A post is remembered once the destination site has decided it (published, duplicate or rejected
 * for good); a failure that may pass (server or network trouble) is retried next run.
 */
export async function runOnce(deps: RunDeps): Promise<RunSummary> {
  const {
    offers,
    ingest,
    seen,
    now = () => new Date(),
    gapMs = 0,
    politeMs = 0,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = () => {},
  } = deps;
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

  const pending = selectOffers(offers, { seen, now: now(), maxAgeMs: deps.maxAgeMs });
  summary.skipped = offers.length - pending.length;

  for (const [index, offer] of pending.entries()) {
    if (deps.deadline !== undefined && now().getTime() >= deps.deadline) {
      summary.stopped = "budget";
      break;
    }
    const outcome = await ingest(offer);
    log(`${offer.source}#${offer.sourceId} ${offer.title.slice(0, 50)} -> ${outcome.kind}`);

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
    const wait = outcome.kind === "published" ? gapMs : politeMs;
    if (wait > 0 && index < pending.length - 1) await sleep(wait);
  }
  return summary;
}
