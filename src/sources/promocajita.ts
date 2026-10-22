import type { Page } from "playwright";

import { copAmounts, relativeTime, withPage } from "../browser.ts";
import type { Source, SourceOffer } from "../types.ts";

export const PROMOCAJITA_HOME = "https://www.promocajita.com/";

/** What the home page shows for one offer, as read from the rendered page. */
export type PromocajitaCard = {
  /** Path of the offer page: /deal/<slug>-<24 hex id> */
  href: string;
  title: string;
  /** Visible text of the card: time, category, prices, discount. */
  text: string;
  /** The "VER OFERTA" link: the store, with the community's affiliate tag. */
  link: string | null;
  image: string | null;
  /** The card's category link text, e.g. "CUIDADO FACIAL". */
  category: string | null;
};

const OBJECT_ID = /([0-9a-f]{24})$/;

/** The card lists its shipping facts as lines: "Envío gratis", "Elegible Envío gratis", "Requiere Casillero". */
function hasLine(text: string, pattern: RegExp): boolean {
  return text.split("\n").some((line) => pattern.test(line.trim()));
}

function createdAt(objectId: string): Date | null {
  const date = new Date(parseInt(objectId.slice(0, 8), 16) * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Promocajita is a single-page app (the HTML is empty until it runs), so cards are read from the
 * rendered page. The post id is the trailing Mongo ObjectId of its address, whose first four
 * bytes are the creation time in seconds.
 */
export function parsePromocajita(cards: PromocajitaCard[], now: Date): SourceOffer[] {
  const offers: SourceOffer[] = [];
  for (const card of cards) {
    const id = OBJECT_ID.exec(card.href)?.[1];
    const title = card.title.replace(/\s+/g, " ").trim();
    if (!id || title.length < 5 || !card.link || !/^https?:\/\//i.test(card.link)) continue;

    const [price, other] = copAmounts(card.text);
    offers.push({
      source: "promocajita",
      sourceId: id,
      title,
      link: card.link,
      shop: /Tienda\s+([^\n|]+)/.exec(card.text)?.[1]?.trim() ?? null,
      price: price ?? null,
      normalPrice: price !== undefined && other !== undefined && other > price ? other : null,
      currency: "COP",
      // The home card does not show the coupon; it is on the offer page (not read yet).
      coupon: null,
      category: card.category?.replace(/\s+/g, " ").trim() || null,
      freeShipping: hasLine(card.text, /^env[ií]o gratis$/i),
      freeShippingEligible: hasLine(card.text, /^elegible\s+env[ií]o gratis$/i),
      requiresMailbox: hasLine(card.text, /^requiere\s+casillero$/i),
      publishedAt: createdAt(id) ?? relativeTime(card.text, now),
      endAt: null,
      imageUrl: card.image,
    });
  }
  return offers;
}

async function readCards(page: Page): Promise<PromocajitaCard[]> {
  {
    await page.goto(PROMOCAJITA_HOME, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => document.querySelectorAll('a[href^="/deal/"]').length >= 10,
      undefined,
      { timeout: 20_000 },
    );
    return page.evaluate(() => {
      const social = /(facebook|instagram|tiktok|t\.me|whatsapp|grupocajita)/;
      const seen = new Set<string>();
      const cards: PromocajitaCard[] = [];
      for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href^="/deal/"]')) {
        const href = anchor.getAttribute("href")!;
        if (seen.has(href)) continue;
        // The card is the largest ancestor that still holds only this offer.
        const deals = (el: HTMLElement) =>
          new Set([...el.querySelectorAll('a[href^="/deal/"]')].map((a) => a.getAttribute("href")));
        let card: HTMLElement = anchor;
        while (card.parentElement && deals(card.parentElement).size <= 1) card = card.parentElement;
        const titles = [...card.querySelectorAll<HTMLAnchorElement>(`a[href="${href}"]`)];
        const title = titles.map((a) => a.innerText.trim()).find(Boolean) ?? "";
        const link =
          [...card.querySelectorAll<HTMLAnchorElement>('a[href^="http"]')]
            .map((a) => a.href)
            .find((h) => !social.test(h)) ?? null;
        seen.add(href);
        cards.push({
          href,
          title,
          text: card.innerText,
          link,
          image: card.querySelector("img")?.getAttribute("src") ?? null,
          category:
            card.querySelector<HTMLAnchorElement>('a[href^="/deals/categorias/"]')?.innerText ??
            null,
        });
      }
      return cards;
    });
  }
}

/** Offer pages opened per run for their picture: the newest ones; the rest wait for the next run. */
const MAX_IMAGE_PAGES = 15;
const OFFER_IMAGE = /\/images\/offers\//;

/**
 * Most home cards show no picture (they load it lazily, and only a few ever do), but the offer's
 * own page sets `og:image` to the full-size picture (about 1200 px) once it has rendered.
 */
async function readDealImage(page: Page, href: string): Promise<string | null> {
  try {
    await page.goto(new URL(href, PROMOCAJITA_HOME).toString(), { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        /\/images\/offers\//.test(
          document.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? "",
        ),
      undefined,
      { timeout: 10_000 },
    );
    const image = await page.evaluate(
      () => document.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? null,
    );
    return image && OFFER_IMAGE.test(image) ? image : null;
  } catch {
    return null;
  }
}

export const promocajita: Source = {
  name: "promocajita",
  read: ({ isSeen, since }) =>
    withPage(async (page) => {
      const cards = await readCards(page);
      const offers = parsePromocajita(cards, new Date());
      const hrefOf = new Map(cards.map((c) => [OBJECT_ID.exec(c.href)?.[1], c.href]));

      const pending = offers
        .filter((o) => !isSeen(o.sourceId) && o.publishedAt >= since)
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
        .slice(0, MAX_IMAGE_PAGES);
      for (const offer of pending) {
        const href = hrefOf.get(offer.sourceId);
        const image = href ? await readDealImage(page, href) : null;
        // The card's thumbnail (300 px) is the fallback when the page gives no picture.
        if (image) offer.imageUrl = image;
      }
      return offers;
    }),
};
