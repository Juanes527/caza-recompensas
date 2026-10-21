import { resolveStoreUrl } from "./links.ts";
import { SOURCES } from "./sources/index.ts";

/**
 * Reads the sources and prints what would be sent to the destination site. Publishes nothing.
 * `npm run dry-run [source]` reads one source; the first RESOLVE offers of each get their link
 * followed to the store.
 */
const RESOLVE = 4;
const only = process.argv[2];
const now = Date.now();

for (const source of SOURCES.filter((s) => !only || s.name === only)) {
  let offers;
  try {
    offers = await source.read(() => false);
  } catch (error) {
    console.log(`${source.name}: FAILED ${String(error)}\n`);
    continue;
  }
  console.log(`${source.name}: ${offers.length} offers read\n`);

  for (const [index, o] of offers.entries()) {
    const expired = o.endAt !== null && o.endAt.getTime() < now;
    const store =
      index < RESOLVE
        ? await resolveStoreUrl(o.link).catch((e: unknown) => `ERROR ${String(e)}`)
        : "(not followed)";
    console.log(
      [
        `#${o.sourceId}${expired ? " [EXPIRED]" : ""} ${o.title.slice(0, 70)}`,
        `   ${o.shop ?? "?"} · cat ${o.category ?? "-"} · ${o.price ?? "?"} COP (before ${o.normalPrice ?? "?"})` +
          ` · coupon ${o.coupon ?? "-"} · ends ${o.endAt?.toISOString() ?? "-"}` +
          ` · posted ${o.publishedAt.toISOString()} · image ${o.imageUrl ? "yes" : "NO"}`,
        `   ${o.link}\n   -> ${store}`,
      ].join("\n"),
    );
  }
  console.log();
}
