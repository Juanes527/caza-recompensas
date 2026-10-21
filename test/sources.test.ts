import { describe, expect, it } from "vitest";

import { copAmounts, relativeTime } from "../src/browser.ts";
import { unwrapAmazonOnelink } from "../src/links.ts";
import { descuentosTechId, toOffer } from "../src/sources/descuentostech.ts";
import { parsePromocajita, type PromocajitaCard } from "../src/sources/promocajita.ts";

const NOW = new Date("2026-10-21T12:00:00Z");

describe("copAmounts / relativeTime", () => {
  it("reads Colombian prices with dot thousands", () => {
    expect(copAmounts("$94.613 COP | $122.997 COP | -23%")).toEqual([94613, 122997]);
    expect(copAmounts("≈ $26.020 COP")).toEqual([26020]);
    expect(copAmounts("$8.00 USD")).toEqual([]);
  });

  it("turns 'Hace N …' into a moment", () => {
    expect(relativeTime("🕐 Hace 20 min", NOW).toISOString()).toBe("2026-10-21T11:40:00.000Z");
    expect(relativeTime("Hace 8 minutos", NOW).toISOString()).toBe("2026-10-21T11:52:00.000Z");
    expect(relativeTime("Hace 3 horas", NOW).toISOString()).toBe("2026-10-21T09:00:00.000Z");
    expect(relativeTime("Hace 2 días", NOW).toISOString()).toBe("2026-10-19T12:00:00.000Z");
    expect(relativeTime("ayer", NOW)).toEqual(NOW);
  });
});

describe("parsePromocajita", () => {
  const card = (extra: Partial<PromocajitaCard> = {}): PromocajitaCard => ({
    href: "/deal/kit-mini-medicube-glow-favorites-6ad929ea5dc732d88132095e",
    title: "Kit Mini Medicube Glow Favorites, 5 piezas",
    text: "Hace 14 minutos\nCUIDADO FACIAL\nKit Mini Medicube\n$94.613 COP\n$122.997 COP\n-23%\nTienda Amazon\nEnvío gratis\nVER OFERTA",
    link: "https://www.amazon.com/dp/B0H5W743CH?tag=pccajita-20&linkCode=ogi&th=1",
    image: null,
    category: "CUIDADO FACIAL",
    ...extra,
  });

  it("reads prices, store, and the creation time inside the post id", () => {
    const [offer] = parsePromocajita([card()], NOW);
    expect(offer).toMatchObject({
      source: "promocajita",
      sourceId: "6ad929ea5dc732d88132095e",
      price: 94613,
      normalPrice: 122997,
      shop: "Amazon",
      category: "CUIDADO FACIAL",
      currency: "COP",
    });
    expect(offer?.publishedAt.toISOString()).toBe(new Date(0x6ad929ea * 1000).toISOString());
  });

  it("reads free shipping, eligible-for-free-shipping and mailbox from the card lines", () => {
    const shipping = (lines: string) =>
      parsePromocajita([card({ text: `Hace 8 minutos\n$217.610 COP\n${lines}` })], NOW)[0];
    expect(shipping("Envío gratis")).toMatchObject({
      freeShipping: true,
      freeShippingEligible: false,
      requiresMailbox: false,
    });
    expect(shipping("Elegible Envío gratis")).toMatchObject({
      freeShipping: false,
      freeShippingEligible: true,
    });
    expect(shipping("Requiere Casillero\nEnvío gratis")).toMatchObject({
      freeShipping: true,
      requiresMailbox: true,
    });
    expect(shipping("Tienda Amazon")).toMatchObject({
      freeShipping: false,
      requiresMailbox: false,
    });
  });

  it("keeps no old price when the card shows only one", () => {
    const [offer] = parsePromocajita(
      [card({ text: "Hace 8 minutos\n$217.610 COP\nTienda Amazon" })],
      NOW,
    );
    expect(offer).toMatchObject({ price: 217610, normalPrice: null });
  });

  it("skips cards with no store link, no id, or no real title", () => {
    expect(
      parsePromocajita(
        [card({ link: null }), card({ href: "/deal/sin-id" }), card({ title: "ok" })],
        NOW,
      ),
    ).toEqual([]);
  });
});

describe("DescuentosTech", () => {
  const home = {
    href: "/oferta/juego-de-60-destornilladores-de-precision-qhzsk2nc",
    title: "Juego de 60 destornilladores de precisión",
    text: "🕐 Hace 20 min\nJuego de 60\n≈ $26.020 COP\nTienda\nAmazon",
    image: "https://x.supabase.co/a.jpg",
  };

  it("takes the post id from the address", () => {
    expect(descuentosTechId(home.href)).toBe("qhzsk2nc");
    expect(descuentosTechId("/tendencia")).toBeNull();
  });

  it("joins the card with the store link and coupon of its own page", () => {
    const offer = toOffer(
      home,
      {
        link: "https://www.amazon.com/dp/B0CCXT6NMQ?tag=destec2-20",
        coupon: "Y5VHXN7C",
        category: "HERRAMIENTA",
        price: 26020,
        image: null,
      },
      NOW,
    );
    expect(offer).toMatchObject({
      source: "descuentostech",
      sourceId: "qhzsk2nc",
      price: 26020,
      coupon: "Y5VHXN7C",
      category: "HERRAMIENTA",
      imageUrl: "https://x.supabase.co/a.jpg",
      normalPrice: null,
    });
    expect(offer?.publishedAt.toISOString()).toBe("2026-10-21T11:40:00.000Z");
  });

  it("falls back to the card price and drops posts without a store link", () => {
    const withoutPrice = toOffer(
      home,
      {
        link: "https://tienda.co/p",
        coupon: null,
        category: null,
        price: null,
        image: null,
      },
      NOW,
    );
    expect(withoutPrice?.price).toBe(26020);
    expect(
      toOffer(home, { link: null, coupon: null, category: null, price: null, image: null }, NOW),
    ).toBeNull();
  });

  it("uses the product behind an Amazon OneLink wrapper", () => {
    const wrapped =
      "https://www.amazon.co.uk/dp/B0H9Z71PJK?ar_srct=T1&ar_su=https%3A%2F%2Fwww.amazon.com%2Fdp%2FB0H9Z71PJK%3Ftag%3Ddestec2-20";
    expect(unwrapAmazonOnelink(wrapped)).toBe(
      "https://www.amazon.com/dp/B0H9Z71PJK?tag=destec2-20",
    );
    expect(unwrapAmazonOnelink("https://www.amazon.com/dp/B0CCXT6NMQ")).toBe(
      "https://www.amazon.com/dp/B0CCXT6NMQ",
    );
    expect(
      toOffer(
        home,
        {
          link: wrapped,
          coupon: null,
          category: null,
          price: null,
          image: null,
        },
        NOW,
      )?.link,
    ).toBe("https://www.amazon.com/dp/B0H9Z71PJK?tag=destec2-20");
  });
});
