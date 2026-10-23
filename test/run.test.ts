import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ingestOffer, type IngestOutcome } from "../src/destination.ts";
import { policyFromEnv } from "../src/policy.ts";
import { runOnce, selectOffers } from "../src/run.ts";
import { SeenPosts } from "../src/state.ts";
import type { SourceOffer } from "../src/types.ts";

const NOW = new Date("2026-10-21T12:00:00Z");

const offer = (id: number, extra: Partial<SourceOffer> = {}): SourceOffer => ({
  source: "ofertu",
  sourceId: String(id),
  title: `Oferta ${id}`,
  link: `https://amzn.to/${id}`,
  shop: "Amazon",
  price: 1000,
  normalPrice: 2000,
  currency: "COP",
  coupon: null,
  category: null,
  freeShipping: false,
  freeShippingEligible: false,
  requiresMailbox: false,
  publishedAt: new Date(NOW.getTime() - id * 60_000),
  endAt: null,
  imageUrl: null,
  ...extra,
});

const seenFile = () =>
  new SeenPosts(join(mkdtempSync(join(tmpdir(), "bot-")), "seen.json"), () => NOW);

describe("runOnce", () => {
  it("sends the oldest first, remembers decided posts and counts each outcome", async () => {
    const answers: Record<string, IngestOutcome> = {
      "1": { kind: "published", slug: "a" },
      "2": { kind: "duplicate", slug: "b" },
      "3": { kind: "rejected", reason: "unknown_store" },
      "4": { kind: "retry", detail: "HTTP 500" },
    };
    const order: string[] = [];
    const seen = seenFile();
    const summary = await runOnce({
      offers: [offer(1), offer(2), offer(3), offer(4)],
      ingest: async (o) => (order.push(o.sourceId), answers[o.sourceId]!),
      seen,
      now: () => NOW,
    });

    expect(order).toEqual(["4", "3", "2", "1"]);
    expect(summary).toMatchObject({
      published: 1,
      duplicates: 1,
      rejected: { unknown_store: 1 },
      retry: 1,
      stopped: null,
    });
    // published and duplicate are settled; a rejection and a failure are tried again
    expect([1, 2].every((id) => seen.has(offer(id)))).toBe(true);
    expect([3, 4].some((id) => seen.has(offer(id)))).toBe(false);
  });

  it("tries a rejected offer again on the next run, but never an ended one", async () => {
    const seen = seenFile();
    const rejected = (reason: string): IngestOutcome => ({ kind: "rejected", reason });
    let answer: IngestOutcome = rejected("no_images");
    const ingest = vi.fn(async () => answer);

    await runOnce({ offers: [offer(1)], ingest, seen, now: () => NOW });
    answer = { kind: "published", slug: "a" };
    const second = await runOnce({ offers: [offer(1)], ingest, seen, now: () => NOW });
    expect(ingest).toHaveBeenCalledTimes(2);
    expect(second.published).toBe(1);

    const ended = seenFile();
    answer = rejected("expired");
    await runOnce({ offers: [offer(2)], ingest, seen: ended, now: () => NOW });
    const third = await runOnce({ offers: [offer(2)], ingest, seen: ended, now: () => NOW });
    expect(ingest).toHaveBeenCalledTimes(3);
    expect(third.skipped).toBe(1);
  });

  it("stops retrying a rejected offer once it is older than the window", async () => {
    const ingest = vi.fn(async (): Promise<IngestOutcome> => ({
      kind: "rejected",
      reason: "bad_link",
    }));
    const old = offer(1, { publishedAt: new Date(NOW.getTime() - 121 * 60_000) });
    await runOnce({
      offers: [old],
      ingest,
      seen: seenFile(),
      now: () => NOW,
      maxAgeMs: 120 * 60_000,
    });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("skips posts already seen and deals that already ended, without calling the destination site", async () => {
    const seen = seenFile();
    seen.add(offer(1));
    const ingest = vi.fn(async (): Promise<IngestOutcome> => ({
      kind: "published",
      slug: "x",
    }));
    const summary = await runOnce({
      offers: [offer(1), offer(2, { endAt: new Date(NOW.getTime() - 1) }), offer(3)],
      ingest,
      seen,
      now: () => NOW,
    });
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ read: 3, skipped: 2, published: 1 });
  });

  it("stops at the hourly cap and keeps the rest for the next run", async () => {
    const seen = seenFile();
    const ingest = vi
      .fn<() => Promise<IngestOutcome>>()
      .mockResolvedValueOnce({ kind: "published", slug: "a" })
      .mockResolvedValue({ kind: "capped" });
    const summary = await runOnce({
      offers: [offer(3), offer(2), offer(1)],
      ingest,
      seen,
      now: () => NOW,
    });
    expect(summary).toMatchObject({ published: 1, stopped: "capped" });
    expect(ingest).toHaveBeenCalledTimes(2);
    expect(seen.has(offer(1))).toBe(false);
  });

  it("stops on a fatal answer and reports it", async () => {
    const summary = await runOnce({
      offers: [offer(1), offer(2)],
      ingest: async () => ({ kind: "fatal", detail: "HTTP 401" }),
      seen: seenFile(),
      now: () => NOW,
    });
    expect(summary).toMatchObject({ stopped: "fatal", detail: "HTTP 401" });
  });
});

describe("ingestOffer", () => {
  const config = (status: number, body: unknown) => ({
    baseUrl: "https://example.com",
    secret: "s".repeat(32),
    fetch: vi.fn(async () => Response.json(body, { status })) as unknown as typeof fetch,
  });

  it("sends only the facts of the post, with the secret", async () => {
    const c = config(201, { slug: "x" });
    await ingestOffer(
      c,
      offer(1, {
        coupon: "ABC12",
        category: "CUIDADO FACIAL",
        freeShippingEligible: true,
        requiresMailbox: true,
        endAt: NOW,
      }),
    );
    const [url, init] = vi.mocked(c.fetch).mock.calls[0]!;
    expect(String(url)).toBe("https://example.com/api/bot/ingest");
    expect((init!.headers as Record<string, string>).authorization).toBe(
      `Bearer ${"s".repeat(32)}`,
    );
    expect(JSON.parse(init!.body as string)).toEqual({
      link: "https://amzn.to/1",
      title: "Oferta 1",
      couponCode: "ABC12",
      category: "CUIDADO FACIAL",
      freeShippingEligible: true,
      requiresMailbox: true,
      currentPrice: 1000,
      originalPrice: 2000,
      endAt: NOW.toISOString(),
    });
  });

  it.each([
    [201, { slug: "s" }, { kind: "published", slug: "s" }],
    [409, { slug: "s" }, { kind: "duplicate", slug: "s" }],
    [422, { reason: "no_images" }, { kind: "rejected", reason: "no_images" }],
    [429, { reason: "rate_limited" }, { kind: "capped" }],
    [401, { error: "x" }, { kind: "fatal", detail: "HTTP 401" }],
    [503, { error: "x" }, { kind: "fatal", detail: "HTTP 503" }],
    [500, { error: "x" }, { kind: "retry", detail: "HTTP 500" }],
  ])("maps HTTP %i", async (status, body, expected) => {
    expect(await ingestOffer(config(status, body), offer(1))).toEqual(expected);
  });

  it("retries later when the network fails", async () => {
    const c = {
      ...config(200, {}),
      fetch: vi.fn(async () => Promise.reject(new Error("down"))) as unknown as typeof fetch,
    };
    expect(await ingestOffer(c, offer(1))).toMatchObject({ kind: "retry" });
  });
});

describe("selectOffers", () => {
  const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
  const post = (id: number, minutes: number, extra: Partial<SourceOffer> = {}) =>
    offer(id, { publishedAt: ago(minutes), ...extra });

  it("takes only recent posts, so a first run does not publish a whole page", () => {
    const selected = selectOffers([post(1, 10), post(2, 119), post(3, 121), post(4, 600)], {
      seen: seenFile(),
      now: NOW,
      maxAgeMs: 120 * 60_000,
    });
    expect(selected.map((o) => o.sourceId)).toEqual(["2", "1"]);
  });

  it("has no cap: every recent unseen post is selected, oldest first", () => {
    const offers = Array.from({ length: 40 }, (_, i) => post(i + 1, 100 - i));
    const selected = selectOffers(offers, { seen: seenFile(), now: NOW, maxAgeMs: 120 * 60_000 });
    expect(selected).toHaveLength(40);
    expect(selected[0]?.sourceId).toBe("1");
  });

  it("leaves out seen posts and deals that ended", () => {
    const seen = seenFile();
    seen.add(post(5, 1));
    const offers = [post(1, 50), post(2, 40, { endAt: ago(1) }), post(3, 30), post(5, 1)];
    expect(selectOffers(offers, { seen, now: NOW }).map((o) => o.sourceId)).toEqual(["1", "3"]);
  });
});

describe("the queue", () => {
  const run = async (
    answers: IngestOutcome[],
    extra: Partial<Parameters<typeof runOnce>[0]> = {},
  ) => {
    const waits: number[] = [];
    const offers = answers.map((_, i) => offer(i + 1));
    const summary = await runOnce({
      offers,
      ingest: async (o) => answers[Number(o.sourceId) - 1]!,
      seen: seenFile(),
      now: () => NOW,
      gapMs: 120_000,
      politeMs: 3_000,
      sleep: async (ms) => void waits.push(ms),
      ...extra,
    });
    return { summary, waits };
  };

  it("waits 45 s after each published offer, a short pause after the others, and not after the last", async () => {
    const published: IngestOutcome = { kind: "published", slug: "a" };
    const { waits } = await run([
      published,
      published,
      { kind: "duplicate", slug: "d" },
      { kind: "rejected", reason: "no_images" },
      published,
    ]);
    // offers are sent oldest first: 5, 4, 3, 2, 1
    expect(waits).toEqual([45_000, 3_000, 3_000, 45_000]);
  });

  it("publishes as many as there are, with no limit", async () => {
    const { summary } = await run(
      Array.from({ length: 30 }, () => ({ kind: "published", slug: "a" }) as const),
    );
    expect(summary.published).toBe(30);
  });

  it("stops starting offers once the time budget is over, keeping the rest for the next run", async () => {
    let clock = NOW.getTime();
    const { summary } = await run(
      Array.from({ length: 5 }, () => ({ kind: "published", slug: "a" }) as const),
      {
        now: () => new Date(clock),
        sleep: async (ms) => void (clock += ms),
        deadline: NOW.getTime() + 100_000,
      },
    );
    // sends at t=0, 45 s, 90 s; at 135 s the budget (100 s) is over
    expect(summary).toMatchObject({ published: 3, stopped: "budget" });
  });
});

describe("policyFromEnv", () => {
  it("defaults to the last two hours and 2 minutes between offers, and accepts overrides", () => {
    expect(policyFromEnv({})).toEqual({ maxAgeMs: 120 * 60_000, gapMs: 120_000 });
    expect(policyFromEnv({ BOT_MAX_AGE_MINUTES: "30", BOT_GAP_SECONDS: "60" })).toEqual({
      maxAgeMs: 30 * 60_000,
      gapMs: 60_000,
    });
    expect(policyFromEnv({ BOT_MAX_AGE_MINUTES: "-5", BOT_GAP_SECONDS: "x" })).toEqual({
      maxAgeMs: 120 * 60_000,
      gapMs: 120_000,
    });
  });
});
