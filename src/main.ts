import { ingestConfigFromEnv, ingestOffer } from "./destination.ts";
import { runOnce, type RunSummary } from "./run.ts";
import { SOURCES } from "./sources/index.ts";
import { SeenPosts } from "./state.ts";

const config = ingestConfigFromEnv();
const seen = new SeenPosts(process.env.STATE_FILE ?? "seen-posts.json");
const only = process.env.ONLY_SOURCE;

let failed = false;
for (const source of SOURCES.filter((s) => !only || s.name === only)) {
  // One broken source must not stop the others: report it and go on.
  let summary: RunSummary;
  try {
    const offers = await source.read((id) => seen.hasId(source.name, id));
    summary = await runOnce({
      offers,
      ingest: (offer) => ingestOffer(config, offer),
      seen,
      delayMs: 3_000,
      log: (line) => console.log(`[${source.name}] ${line}`),
    });
  } catch (error) {
    failed = true;
    console.error(`[${source.name}] FAILED: ${String(error)}`);
    continue;
  }
  seen.save();
  console.log(JSON.stringify({ source: source.name, ...summary }));
  if (summary.stopped === "fatal") failed = true;
  if (summary.stopped) break;
}
process.exitCode = failed ? 1 : 0;
