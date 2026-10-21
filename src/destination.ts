import type { SourceOffer } from "./types.ts";

export type IngestConfig = {
  /** Site origin, e.g. https://example.com */
  baseUrl: string;
  secret: string;
  fetch?: typeof fetch;
};

/** What the destination site answered to one offer, reduced to what the run has to decide. */
export type IngestOutcome =
  | { kind: "published"; slug: string }
  | { kind: "duplicate"; slug: string }
  /** Will never be publishable (expired, unknown store, no images…): do not try again. */
  | { kind: "rejected"; reason: string }
  /** Hourly cap reached: stop the run, keep the rest for the next one. */
  | { kind: "capped" }
  /** Server or network trouble: try this offer again next run. */
  | { kind: "retry"; detail: string }
  /** The bot cannot work at all (bad secret, endpoint off): stop and report. */
  | { kind: "fatal"; detail: string };

const TIMEOUT_MS = 60_000;

export function ingestConfigFromEnv(env: NodeJS.ProcessEnv = process.env): IngestConfig {
  const baseUrl = env.TARGET_URL;
  const secret = env.BOT_INGEST_SECRET;
  if (!baseUrl || !secret) throw new Error("TARGET_URL and BOT_INGEST_SECRET are required");
  return { baseUrl, secret };
}

export async function ingestOffer(
  config: IngestConfig,
  offer: SourceOffer,
): Promise<IngestOutcome> {
  const body = {
    link: offer.link,
    title: offer.title,
    ...(offer.coupon && { couponCode: offer.coupon }),
    ...(offer.category && { category: offer.category }),
    ...(offer.freeShipping && { freeShipping: true }),
    ...(offer.freeShippingEligible && { freeShippingEligible: true }),
    ...(offer.requiresMailbox && { requiresMailbox: true }),
    ...(offer.price && { currentPrice: offer.price }),
    ...(offer.normalPrice && offer.price && { originalPrice: offer.normalPrice }),
    ...(offer.endAt && { endAt: offer.endAt.toISOString() }),
    ...(offer.imageUrl && { imageUrl: offer.imageUrl }),
  };

  let response: Response;
  try {
    response = await (config.fetch ?? fetch)(new URL("/api/bot/ingest", config.baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { kind: "retry", detail: String(error) };
  }

  const answer: unknown = await response.json().catch(() => null);
  const field = (name: string) =>
    typeof answer === "object" && answer !== null && name in answer
      ? String((answer as Record<string, unknown>)[name])
      : "";

  switch (response.status) {
    case 201:
      return { kind: "published", slug: field("slug") };
    case 409:
      return { kind: "duplicate", slug: field("slug") };
    case 422:
      return { kind: "rejected", reason: field("reason") || "unprocessable" };
    case 429:
      return { kind: "capped" };
    case 400:
      // Our own request was malformed: this offer will never go through.
      return { kind: "rejected", reason: `bad_request:${field("fields")}` };
    case 401:
    case 503:
      return { kind: "fatal", detail: `HTTP ${response.status}` };
    default:
      return { kind: "retry", detail: `HTTP ${response.status}` };
  }
}
