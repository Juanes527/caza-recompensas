/**
 * Which posts the bot takes and at what pace. There is no cap on how many it publishes: it follows
 * the communities, only the recent posts, and spaces them out in a queue so the feed never gets a
 * burst.
 */
export const DEFAULT_MAX_AGE_MINUTES = 120;
/** Wait after each published offer. */
export const DEFAULT_GAP_SECONDS = 45;
/** Wait after an offer that was not published (duplicate, rejected). */
export const POLITE_MS = 3_000;
/** A run stops starting offers after this long, so it finishes before the next scheduled one. */
export const RUN_BUDGET_MS = 25 * 60_000;

export type Policy = { maxAgeMs: number; gapMs: number };

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function policyFromEnv(env: NodeJS.ProcessEnv = process.env): Policy {
  return {
    maxAgeMs: positiveInt(env.BOT_MAX_AGE_MINUTES, DEFAULT_MAX_AGE_MINUTES) * 60_000,
    gapMs: positiveInt(env.BOT_GAP_SECONDS, DEFAULT_GAP_SECONDS) * 1_000,
  };
}
