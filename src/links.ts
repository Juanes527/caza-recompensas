const MAX_HOPS = 6;
const TRACKING =
  /^(utm_|fbclid$|gclid$|tag$|ref$|ref_$|linkcode$|linkid$|camp$|creative$|th$|psc$)/i;

/**
 * Follows redirects (short affiliate links) up to the store page and strips
 * tracking and affiliate parameters. Only for reporting and dedupe keys:
 * The destination site cleans the link again and adds its own affiliate code.
 */
export async function resolveStoreUrl(link: string): Promise<string> {
  let url = new URL(link);
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new Error("unsupported protocol");
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "user-agent": "Mozilla/5.0 (compatible; CazaRecompensas/0.1)" },
      signal: AbortSignal.timeout(15_000),
    });
    await res.body?.cancel();
    const next = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !next) return clean(url);
    url = new URL(next, url);
  }
  throw new Error("too many redirects");
}

export function clean(url: URL): string {
  const out = new URL(url);
  for (const key of [...out.searchParams.keys()]) {
    if (TRACKING.test(key)) out.searchParams.delete(key);
  }
  out.hash = "";
  const asin = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/.exec(out.pathname)?.[1];
  if (/(^|\.)amazon\./.test(out.hostname) && asin) return `https://${out.hostname}/dp/${asin}`;
  return out.toString();
}

/**
 * Amazon Associates "OneLink" sometimes wraps the real product link in another country's store
 * (amazon.co.uk/…?ar_su=<the amazon.com link>). The wrapped link is the one the post meant.
 */
export function unwrapAmazonOnelink(link: string): string {
  try {
    const wrapped = new URL(link).searchParams.get("ar_su");
    return wrapped && /^https?:\/\//i.test(wrapped) ? wrapped : link;
  } catch {
    return link;
  }
}
