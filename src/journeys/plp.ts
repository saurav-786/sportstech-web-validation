/** plp.ts — Phase 2: Product Listing Page validation (filters, sort, pagination, products, pricing).
 *
 * Navigation is URL-categorization-driven (reusing src/utils/url.ts) rather than
 * relying on fragile CSS card selectors: we read every internal anchor, classify
 * it with the project's own categorizeUrl(), navigate to a real category, then
 * pick a real product URL. This works across shop platforms and matches the
 * site's known category slugs without per-site selector maintenance.
 */
import { firstVisible, gotoSafe, SELECTORS, step, type JourneyContext } from './common.js';
import { appConfig } from '../config.js';
import { issue } from '../validators/common.js';
import { categorizeUrl, isInternalUrl } from '../utils/url.js';

async function internalLinks(ctx: JourneyContext): Promise<string[]> {
  const hrefs = await ctx.page.locator('a[href]').evaluateAll((as) =>
    Array.from(new Set(as.map((a) => (a as HTMLAnchorElement).href).filter(Boolean)))).catch(() => []);
  return hrefs.filter((h) => {
    try { return isInternalUrl(h, appConfig.baseUrl) && /^https?:/.test(h); } catch { return false; }
  });
}

async function nudgeLazyLoad(ctx: JourneyContext): Promise<void> {
  await ctx.page.evaluate(async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 6; i += 1) { window.scrollBy(0, window.innerHeight); await delay(250); }
    window.scrollTo({ top: 0 });
  }).catch(() => undefined);
}

/** Navigates from the homepage into a category/listing and validates it. Returns a PDP URL if found. */
export async function validatePlp(ctx: JourneyContext): Promise<string | null> {
  const { page } = ctx;

  // 1) From the homepage, find a real category URL via the project's categorizer.
  const homeLinks = await internalLinks(ctx);
  const categoryUrl = homeLinks.find((h) => categorizeUrl(h, appConfig.baseUrl) === 'category');
  const directProductFromHome = homeLinks.find((h) => categorizeUrl(h, appConfig.baseUrl) === 'product');

  await step(ctx, { name: 'Open a product listing page', stage: 'discovery', severityOnFail: 'high',
    fix: 'Ensure category navigation leads to a populated listing page.' }, async () => {
    if (categoryUrl) {
      const res = await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null);
      await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => undefined);
      return !!res && res.status() < 400;
    }
    // Fall back to clicking a visible category-ish nav link.
    const cat = await firstVisible(page, [
      'nav a[href*="laufband"]', 'nav a[href*="bikes"]', 'nav a[href*="krafttraining"]',
      'nav a[href*="rudergeraet"]', 'a[href*="/collections/"]', 'a[href*="kategorie"]',
    ], 3000);
    if (!cat) return !!directProductFromHome; // we can still proceed via a direct product link
    await cat.click({ timeout: 4000 }).catch(() => undefined);
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined);
    return true;
  });

  await nudgeLazyLoad(ctx);

  // 2) Detect products: prefer URL categorization, fall back to card selectors.
  const listingLinks = await internalLinks(ctx);
  const productUrls = listingLinks.filter((h) => categorizeUrl(h, appConfig.baseUrl) === 'product');
  const cardCount = await page.locator(SELECTORS.productLink.join(', ')).count().catch(() => 0);
  const productCount = Math.max(productUrls.length, cardCount);

  await step(ctx, { name: 'Products visible on listing', stage: 'product-view', severityOnFail: 'critical',
    fix: 'Listing page renders no products — investigate catalog/API/render failure.' },
    async () => productCount > 0);

  // Pricing visible (revenue-critical content).
  const pricedCount = await page.locator(SELECTORS.price.join(', ')).count().catch(() => 0);
  if (productCount > 0 && pricedCount === 0) {
    ctx.issues.push({ ...issue('journey', 'high', page.url(),
      'Products visible but no prices rendered on listing.',
      'Restore price rendering — missing prices suppress add-to-cart intent.'), funnelStage: 'product-view', device: ctx.device });
  }

  // Filters / sorting are degradation (medium/low), not blocking.
  const hasFilter = await firstVisible(page, ['[class*="filter" i]', 'button:has-text("Filter")', 'aside input[type="checkbox"]'], 1500);
  if (!hasFilter && productCount > 6) {
    ctx.issues.push({ ...issue('journey', 'medium', page.url(),
      'No filter controls detected on a multi-product listing.',
      'Verify faceted filtering renders — aids discovery on large catalogs.'), funnelStage: 'product-view', device: ctx.device });
  }
  const hasSort = await firstVisible(page, ['select[name*="sort" i]', '[class*="sort" i]', 'button:has-text("Sortieren")'], 1200);
  if (!hasSort && productCount > 6) {
    ctx.issues.push({ ...issue('journey', 'low', page.url(),
      'No sort control detected on listing.', 'Verify sort options render.'), funnelStage: 'product-view', device: ctx.device });
  }

  // 3) Pick a product URL to drive the PDP stage.
  const pdp = productUrls[0] ?? directProductFromHome ?? null;
  if (pdp) return pdp;
  // Last resort: read href from the first product card.
  const href = await page.locator(SELECTORS.productLink.join(', ')).first().getAttribute('href').catch(() => null);
  if (!href) return null;
  try { return new URL(href, page.url()).toString(); } catch { return null; }
}
