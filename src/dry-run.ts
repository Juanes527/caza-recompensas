import { resolveStoreUrl } from "./links.ts";
import { policyFromEnv } from "./policy.ts";
import { selectOffers } from "./run.ts";
import { SOURCES } from "./sources/index.ts";
import { SeenPosts } from "./state.ts";

/**
 * Reads the sources and prints what the next run would send to the destination site, with the
 * same selection (recent, newest few per source). Publishes nothing and remembers nothing.
 * `npm run dry-run [source]` reads one source; the first RESOLVE offers of each get their link
 * followed to the store.
 */
const RESOLVE = 4;
const only = process.argv[2];
const policy = policyFromEnv();
const seen = new SeenPosts(process.env.STATE_FILE ?? "seen-posts.json");
const now = new Date();

for (const source of SOURCES.filter((s) => !only || s.name === only)) {
  let offers;
  try {
    offers = await source.read({
      isSeen: (id) => seen.hasId(source.name, id),
      since: new Date(now.getTime() - policy.maxAgeMs),
    });
  } catch (error) {
    console.log(`${source.name}: FAILED ${String(error)}\n`);
    continue;
  }
  const selected = selectOffers(offers, { seen, now, ...policy });
  console.log(
    `${source.name}: ${offers.length} offers read, ${selected.length} would be sent ` +
      `(max ${policy.limit}, at most ${policy.maxAgeMs / 60_000} min old)\n`,
  );

  for (const [index, o] of selected.entries()) {
    const store =
      index < RESOLVE
        ? await resolveStoreUrl(o.link).catch((e: unknown) => `ERROR ${String(e)}`)
        : "(not followed)";
    console.log(
      [
        `#${o.sourceId} ${o.title.slice(0, 70)}`,
        `   ${o.shop ?? "?"} · cat ${o.category ?? "-"} · ${o.price ?? "?"} COP (before ${o.normalPrice ?? "?"})` +
          ` · coupon ${o.coupon ?? "-"} · posted ${o.publishedAt.toISOString()}`,
        `   ${o.link}\n   -> ${store}`,
      ].join("\n"),
    );
  }
  console.log();
}
