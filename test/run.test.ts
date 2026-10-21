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
    expect(seen.has(offer(4))).toBe(false);
    expect([1, 2, 3].every((id) => seen.has(offer(id)))).toBe(true);
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
    await ingestOffer(c, offer(1, { coupon: "ABC12", category: "CUIDADO FACIAL", endAt: NOW }));
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

  it("keeps the newest few when there are more, and sends them oldest first", () => {
    const offers = [post(1, 50), post(2, 40), post(3, 30), post(4, 20), post(5, 10)];
    const selected = selectOffers(offers, { seen: seenFile(), now: NOW, limit: 3 });
    expect(selected.map((o) => o.sourceId)).toEqual(["3", "4", "5"]);
  });

  it("leaves out seen posts and deals that ended, before counting the limit", () => {
    const seen = seenFile();
    seen.add(post(5, 1));
    const offers = [
      post(1, 50),
      post(2, 40, { endAt: ago(1) }),
      post(3, 30),
      post(4, 20),
      post(5, 1),
    ];
    const selected = selectOffers(offers, { seen, now: NOW, limit: 2 });
    expect(selected.map((o) => o.sourceId)).toEqual(["3", "4"]);
  });
});

describe("policyFromEnv", () => {
  it("defaults to the last two hours and three posts per source, and accepts overrides", () => {
    expect(policyFromEnv({})).toEqual({ maxAgeMs: 120 * 60_000, limit: 3 });
    expect(policyFromEnv({ BOT_MAX_AGE_MINUTES: "30", BOT_MAX_PER_SOURCE: "1" })).toEqual({
      maxAgeMs: 30 * 60_000,
      limit: 1,
    });
    expect(policyFromEnv({ BOT_MAX_AGE_MINUTES: "-5", BOT_MAX_PER_SOURCE: "x" })).toEqual({
      maxAgeMs: 120 * 60_000,
      limit: 3,
    });
  });
});
