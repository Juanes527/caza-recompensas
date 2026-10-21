import type { Page } from "playwright";

import { copAmounts, relativeTime, withPage } from "../browser.ts";
import { unwrapAmazonOnelink } from "../links.ts";
import type { Source, SourceOffer } from "../types.ts";

const ORIGIN = "https://descuentostech.com";
/** Offer pages opened per run: the newest unseen ones; the rest wait for the next run. */
const MAX_DETAIL_PAGES = 12;

/** What the home page shows for one offer. */
export type DescuentosTechCard = {
  /** Path of the offer page: /oferta/<slug>-<8 chars id> */
  href: string;
  title: string;
  /** Visible text of the card: time and price. */
  text: string;
  image: string | null;
};

/** What only the offer's own page has: the store link and the coupon. */
export type DescuentosTechDetail = {
  /** The "VER OFERTA" link: the store, with the community's affiliate tag. */
  link: string | null;
  coupon: string | null;
  /** The offer's category as shown on its page, e.g. "HERRAMIENTA". */
  category: string | null;
  /** Price in COP from the page's structured data. */
  price: number | null;
  image: string | null;
};

const POST_ID = /-([a-z0-9]{8})$/;

export function descuentosTechId(href: string): string | null {
  return POST_ID.exec(href)?.[1] ?? null;
}

/**
 * DescuentosTech is a single-page app: the home lists the offers but only each offer's page has
 * the store link and the coupon, so those pages are opened for the posts not seen yet.
 * Its prices are conversions to COP of the store's USD price.
 */
export function toOffer(
  card: DescuentosTechCard,
  detail: DescuentosTechDetail,
  now: Date,
): SourceOffer | null {
  const id = descuentosTechId(card.href);
  const title = card.title.replace(/\s+/g, " ").trim();
  if (!id || title.length < 5 || !detail.link || !/^https?:\/\//i.test(detail.link)) return null;
  return {
    source: "descuentostech",
    sourceId: id,
    title,
    link: unwrapAmazonOnelink(detail.link),
    shop: null,
    price: detail.price ?? copAmounts(card.text)[0] ?? null,
    // The page shows a discount and the store's USD price, not the old price in COP.
    normalPrice: null,
    currency: "COP",
    coupon: detail.coupon,
    category: detail.category,
    // The offer page shows nothing about shipping.
    freeShipping: false,
    freeShippingEligible: false,
    requiresMailbox: false,
    publishedAt: relativeTime(card.text, now),
    endAt: null,
    imageUrl: detail.image ?? card.image,
  };
}

async function readCards(page: Page): Promise<DescuentosTechCard[]> {
  await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".dt-card a.dt-card-main");
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".dt-card")].flatMap((card) => {
      const href = card.querySelector("a.dt-card-main")?.getAttribute("href");
      if (!href) return [];
      return [
        {
          href,
          title: card.querySelector<HTMLElement>(".dt-card-title")?.innerText ?? "",
          text: card.innerText,
          image: card.querySelector("img")?.getAttribute("src") ?? null,
        },
      ];
    }),
  );
}

async function readDetail(page: Page, href: string): Promise<DescuentosTechDetail> {
  await page.goto(new URL(href, ORIGIN).toString(), {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector("a.dt-btn-ver, .dt-card-error, h1");
  return page.evaluate(() => {
    const text = (selector: string) =>
      document.querySelector<HTMLElement>(selector)?.innerText.trim() || null;
    let price: number | null = null;
    let image: string | null = null;
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const graph = JSON.parse(script.textContent ?? "");
        const product = (graph["@graph"] ?? [graph]).find(
          (n: { "@type"?: string }) => n["@type"] === "Product",
        );
        const offerPrice = Number(product?.offers?.price);
        if (Number.isFinite(offerPrice) && offerPrice > 0) price = offerPrice;
        const pictures = [product?.image].flat().filter((u) => typeof u === "string");
        image = pictures[0] ?? null;
      } catch {
        // structured data is optional
      }
    }
    return {
      link: document.querySelector<HTMLAnchorElement>("a.dt-btn-ver")?.href ?? null,
      coupon: text(".dt-coupon-code"),
      category: text(".dt-meta-cat"),
      price,
      image,
    };
  });
}

export const descuentostech: Source = {
  name: "descuentostech",
  read: ({ isSeen, since }) =>
    withPage(async (page) => {
      const now = new Date();
      const cards = (await readCards(page)).filter((c) => {
        const id = descuentosTechId(c.href);
        return id !== null && !isSeen(id) && relativeTime(c.text, now) >= since;
      });
      const offers: SourceOffer[] = [];
      for (const card of cards.slice(0, MAX_DETAIL_PAGES)) {
        const offer = toOffer(card, await readDetail(page, card.href), now);
        if (offer) offers.push(offer);
      }
      return offers;
    }),
};
