import { chromium, type Page } from "playwright";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/**
 * Runs `work` on a page of a headless Chromium and always closes the browser. Images, media and
 * fonts are not downloaded: the bot only reads the address of the pictures, and the run is faster.
 */
export async function withPage<T>(work: (page: Page) => Promise<T>): Promise<T> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      locale: "es-CO",
      userAgent: USER_AGENT,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    await page.route("**/*", (route) =>
      ["image", "media", "font"].includes(route.request().resourceType())
        ? route.abort()
        : route.continue(),
    );
    return await work(page);
  } finally {
    await browser.close();
  }
}

/** "$217.610 COP" → 217610. Dots are thousands separators in Colombian prices. */
export function copAmounts(text: string): number[] {
  return [...text.matchAll(/\$\s*([\d.]+)\s*COP/g)]
    .map((m) => Number(m[1]!.replaceAll(".", "")))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** "Hace 8 minutos", "Hace 1 min", "Hace 3 horas", "Hace 2 días" → the moment it means. */
export function relativeTime(text: string, now: Date): Date {
  const m = /hace\s+(\d+)\s*(min|minuto|minutos|h|hora|horas|d|día|días|dia|dias)\b/i.exec(text);
  if (!m) return now;
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  const ms = unit.startsWith("m") ? 60_000 : unit.startsWith("h") ? 3_600_000 : 86_400_000;
  return new Date(now.getTime() - n * ms);
}
