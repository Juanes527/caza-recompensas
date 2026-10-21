/**
 * Which posts the bot takes. It is meant to follow the communities, not to copy their pages:
 * only recent posts, and only a few per source on each run.
 */
export const DEFAULT_MAX_AGE_MINUTES = 120;
export const DEFAULT_MAX_PER_SOURCE = 3;

export type Policy = { maxAgeMs: number; limit: number };

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function policyFromEnv(env: NodeJS.ProcessEnv = process.env): Policy {
  return {
    maxAgeMs: positiveInt(env.BOT_MAX_AGE_MINUTES, DEFAULT_MAX_AGE_MINUTES) * 60_000,
    limit: positiveInt(env.BOT_MAX_PER_SOURCE, DEFAULT_MAX_PER_SOURCE),
  };
}
