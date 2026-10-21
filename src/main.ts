import { ingestConfigFromEnv, ingestOffer } from "./destination.ts";
import { policyFromEnv, POLITE_MS, RUN_BUDGET_MS } from "./policy.ts";
import { runOnce } from "./run.ts";
import { SOURCES } from "./sources/index.ts";
import { SeenPosts } from "./state.ts";
import type { SourceOffer } from "./types.ts";

const started = Date.now();
const config = ingestConfigFromEnv();
const seen = new SeenPosts(process.env.STATE_FILE ?? "seen-posts.json");
const only = process.env.ONLY_SOURCE;
const policy = policyFromEnv();

// Every source is read first and their offers share ONE queue, so the pace between publications
// holds across sources. One broken source must not stop the others: report it and go on.
let failed = false;
const offers: SourceOffer[] = [];
for (const source of SOURCES.filter((s) => !only || s.name === only)) {
  try {
    const read = await source.read({
      isSeen: (id) => seen.hasId(source.name, id),
      since: new Date(Date.now() - policy.maxAgeMs),
    });
    console.log(`[${source.name}] read ${read.length}`);
    offers.push(...read);
  } catch (error) {
    failed = true;
    console.error(`[${source.name}] FAILED: ${String(error)}`);
  }
}

const summary = await runOnce({
  offers,
  ingest: (offer) => ingestOffer(config, offer),
  seen,
  maxAgeMs: policy.maxAgeMs,
  gapMs: policy.gapMs,
  politeMs: POLITE_MS,
  deadline: started + RUN_BUDGET_MS,
  log: console.log,
});
seen.save();

console.log(JSON.stringify(summary));
if (summary.stopped === "fatal") failed = true;
process.exitCode = failed ? 1 : 0;
