import { afterEach, describe, expect, it, vi } from "vitest";

import { looksLikeErrorPage, resolveOrKeep } from "../src/links.ts";
import { runOnce } from "../src/run.ts";
import { SeenPosts } from "../src/state.ts";
import type { SourceOffer } from "../src/types.ts";

afterEach(() => vi.unstubAllGlobals());

/** A fake `fetch` that answers each URL with a redirect to the next one in the chain. */
function stubRedirects(chain: Record<string, string | null>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const next = chain[String(input)];
      if (next === undefined) throw new Error("unexpected " + String(input));
      return next === null
        ? new Response("", { status: 200 })
        : new Response("", { status: 302, headers: { location: next } });
    }),
  );
}

describe("looksLikeErrorPage", () => {
  it("flags the pages stores send robots to", () => {
    expect(looksLikeErrorPage("https://www.ebay.com/n/error?statuscode=500")).toBe(true);
    expect(looksLikeErrorPage("https://www.amazon.com/errors/validateCaptcha")).toBe(true);
    expect(looksLikeErrorPage("https://www.ebay.com/itm/189052825936")).toBe(false);
  });
});

describe("resolveOrKeep", () => {
  it("follows a short link up to the product and drops the affiliate tag", async () => {
    stubRedirects({
      "https://link.amazon/abc": "https://amzlinks.in/abc",
      "https://amzlinks.in/abc": "https://www.amazon.com/dp/B0FDVSCRGP?tag=otro-20&th=1",
      "https://www.amazon.com/dp/B0FDVSCRGP?tag=otro-20&th=1": null,
    });
    expect(await resolveOrKeep("https://link.amazon/abc")).toBe(
      "https://www.amazon.com/dp/B0FDVSCRGP",
    );
  });

  it("keeps the original link when the store answers with an error page", async () => {
    stubRedirects({
      "https://ebay.us/xyz": "https://www.ebay.com/n/error?statuscode=500",
      "https://www.ebay.com/n/error?statuscode=500": null,
    });
    expect(await resolveOrKeep("https://ebay.us/xyz")).toBe("https://ebay.us/xyz");
  });

  it("keeps the original link when resolving fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await resolveOrKeep("https://amzn.to/abc")).toBe("https://amzn.to/abc");
  });
});

describe("the run log", () => {
  const offer: SourceOffer = {
    source: "promocajita",
    sourceId: "6ad958585dc732d881341896",
    title: "Cargador Rápido 25W USB-C",
    link: "https://www.amazon.com/dp/B0GH6K6L5L",
    shop: "Amazon",
    price: 26776,
    normalPrice: null,
    currency: "COP",
    coupon: null,
    category: null,
    freeShipping: false,
    freeShippingEligible: false,
    requiresMailbox: false,
    publishedAt: new Date("2026-10-22T00:27:04Z"),
    endAt: null,
    imageUrl: null,
  };

  it("says why an offer was rejected", async () => {
    const lines: string[] = [];
    const seen = new SeenPosts("test-seen-log.json", () => new Date("2026-10-22T00:30:00Z"));
    await runOnce({
      offers: [offer],
      ingest: async () => ({ kind: "rejected", reason: "no_images" }),
      seen,
      now: () => new Date("2026-10-22T00:30:00Z"),
      log: (line) => lines.push(line),
    });
    expect(lines[0]).toContain("-> rejected (no_images)");
  });
});
