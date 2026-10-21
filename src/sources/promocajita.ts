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
      category: card.category?.replace(/s+/g, " ").trim() || null,
      publishedAt: createdAt(id) ?? relativeTime(card.text, now),
      endAt: null,
      imageUrl: card.image,
    });
  }
  return offers;
}

async function readCards(): Promise<PromocajitaCard[]> {
  return withPage(async (page) => {
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
  });
}

export const promocajita: Source = {
  name: "promocajita",
  read: async () => parsePromocajita(await readCards(), new Date()),
};
