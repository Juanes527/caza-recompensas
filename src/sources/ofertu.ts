import type { Source, SourceOffer } from "../types.ts";

export const OFERTU_HOME = "https://www.ofertu.co/";

const NEXT_DATA = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;
const OFFERS_KEY = "/api/ofertu/offers?";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const money = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const date = (v: unknown) => {
  const d = typeof v === "string" ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

function toOffer(raw: unknown): SourceOffer | null {
  if (!isRecord(raw)) return null;
  const id = raw.id;
  const title = text(raw.title);
  const link = text(raw.url);
  const publishedAt = date(raw.published_at);
  if ((typeof id !== "number" && typeof id !== "string") || !title || !publishedAt) return null;
  if (!link || !/^https?:\/\//i.test(link)) return null;
  return {
    source: "ofertu",
    sourceId: String(id),
    title,
    link,
    shop: text(raw.shop),
    price: money(raw.actual_price),
    normalPrice: money(raw.normal_price),
    currency: "COP",
    coupon: text(raw.code),
    category: null,
    publishedAt,
    endAt: date(raw.end_date),
    imageUrl: text(raw.image_url),
  };
}

/**
 * Ofertu is a Next.js site: the home HTML embeds the latest offers in
 * `__NEXT_DATA__`. Throws when that shape disappears so the run is reported as
 * broken instead of silently reading zero offers.
 */
export function parseOfertuHome(html: string): SourceOffer[] {
  const json = NEXT_DATA.exec(html)?.[1];
  if (!json) throw new Error("ofertu: __NEXT_DATA__ not found");
  const data: unknown = JSON.parse(json);
  const fallback =
    isRecord(data) && isRecord(data.props) && isRecord(data.props.pageProps)
      ? data.props.pageProps.fallback
      : null;
  const key = isRecord(fallback)
    ? Object.keys(fallback).find((k) => k.includes(OFFERS_KEY))
    : undefined;
  const list = isRecord(fallback) && key ? fallback[key] : null;
  if (!Array.isArray(list)) throw new Error("ofertu: offers list not found in page data");
  return list.map(toOffer).filter((o): o is SourceOffer => o !== null);
}

export async function fetchOfertu(): Promise<SourceOffer[]> {
  const res = await fetch(OFERTU_HOME, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; CazaRecompensas/0.1)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`ofertu: HTTP ${res.status}`);
  return parseOfertuHome(await res.text());
}

export const ofertu: Source = { name: "ofertu", read: () => fetchOfertu() };
