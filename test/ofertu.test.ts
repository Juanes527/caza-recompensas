import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clean } from "../src/links.ts";
import { parseOfertuHome } from "../src/sources/ofertu.ts";

const html = readFileSync(new URL("./fixtures/ofertu-home.html", import.meta.url), "utf8");

describe("parseOfertuHome", () => {
  const offers = parseOfertuHome(html);

  it("reads the offers embedded in the page", () => {
    expect(offers).toHaveLength(6);
    expect(offers[0]).toMatchObject({
      source: "ofertu",
      sourceId: "91190",
      shop: "Amazon",
      price: 63871,
      normalPrice: 191678,
      coupon: null,
      currency: "COP",
    });
    expect(offers[0]?.link).toMatch(/^https:\/\/amzn\.to\//);
    expect(offers[0]?.endAt).toBeInstanceOf(Date);
  });

  it("reads the shipping facts: cost 0 is free shipping, applies_shipping is eligible", () => {
    expect(offers[0]).toMatchObject({
      freeShipping: true,
      freeShippingEligible: false,
      requiresMailbox: false,
    });
    expect(offers[1]).toMatchObject({ freeShipping: false, freeShippingEligible: false });
    expect(offers[2]).toMatchObject({ freeShipping: false, freeShippingEligible: true });
  });

  it("keeps the coupon code when the post has one", () => {
    expect(offers[1]?.coupon).toBe("CUPON10");
  });

  it("fails loudly when the page shape changes", () => {
    expect(() => parseOfertuHome("<html></html>")).toThrow(/__NEXT_DATA__/);
    const noOffers =
      '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"fallback":{}}}}</script>';
    expect(() => parseOfertuHome(noOffers)).toThrow(/offers list/);
  });
});

describe("clean", () => {
  it("reduces Amazon links to /dp/ASIN without affiliate tags", () => {
    const url = new URL(
      "https://www.amazon.com/Some-Title/dp/B0ABCDEFGH/ref=sr_1_1?tag=ofertu-20&th=1",
    );
    expect(clean(url)).toBe("https://www.amazon.com/dp/B0ABCDEFGH");
  });

  it("drops tracking parameters on other stores", () => {
    expect(clean(new URL("https://tienda.co/p/1?utm_source=x&color=rojo#a"))).toBe(
      "https://tienda.co/p/1?color=rojo",
    );
  });
});
