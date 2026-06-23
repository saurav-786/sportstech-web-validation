/**
 * pdp-discovery.spec.ts — @pdp-discovery suite.
 *
 * Standalone, reusable Product Detail Page (PDP) discovery + validation.
 * For each major Sportstech category it: navigates, handles lazy-load / infinite
 * scroll / pagination, collects product-card / image / title links, validates &
 * de-duplicates URLs, then visits each PDP to verify it is a real, working
 * product page (HTTP 200 · title · price · add-to-cart · image).
 *
 * Reuses the existing framework only — no duplicate helpers:
 *   - test/expect + auto overlay-guard ........ src/fixtures/index.ts
 *   - SELECTORS, firstVisible ................. src/journeys/common.ts
 *   - URL helpers ............................. src/utils/url.ts
 *   - overlay dismissal ...................... src/engine/overlayGuard.ts
 *   - fs + naming helpers .................... src/utils/fs.ts
 *   - issue() for the shared issue sink ...... src/validators/common.ts
 *   - logger ................................. src/utils/logger.ts
 *   - report HTML + shared PDF renderer ...... src/reports/pdpDiscoveryReport.ts + pdf.ts
 *
 *   npm run test:pdp-discovery
 */
import { test, expect } from '../../src/fixtures/index.js';
import type { BrowserContext, Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appConfig } from '../../src/config.js';
import { SELECTORS, firstVisible } from '../../src/journeys/common.js';
import { isInternalUrl, normalizeUrl } from '../../src/utils/url.js';
import { dismissOverlays, installOverlayAutoDismiss } from '../../src/engine/overlayGuard.js';
import { ensureDir, writeJson } from '../../src/utils/fs.js';
import { issue } from '../../src/validators/common.js';
import { createLogger } from '../../src/utils/logger.js';
import { openReport } from '../../src/reports/openReport.js';
import { revenueRunDir } from '../../src/revenue/runArtifacts.js';
import {
  buildPdpDiscoveryReportHtml,
  type BrokenPdp,
  type PdpCategoryResult,
  type PdpDiscoveryReport,
  type PdpProduct,
} from '../../src/reports/pdpDiscoveryReport.js';

const log = createLogger('pdp-discovery');

/** The major product categories to scan (slug → canonical category URL). */
const CATEGORIES: Array<{ name: string; path: string }> = [
  { name: 'laufband', path: '/laufband' },
  { name: 'bikes-ergometer', path: '/bikes-ergometer' },
  { name: 'rudergeraet', path: '/rudergeraet' },
  { name: 'krafttraining', path: '/krafttraining' },
  { name: 'crosstrainer', path: '/crosstrainer' },
  { name: 'vibrationsplatte', path: '/vibrationsplatte' },
  { name: 'zubehoer', path: '/zubehoer' },
  { name: 'bundles', path: '/bundles' },
];

const NON_PRODUCT = /\/(cart|warenkorb|basket|checkout|kasse|payment|login|signin|anmelden|register|signup|account|konto|profile|wishlist|merkzettel|search|suche|sitemap|blog|magazin|ratgeber|impressum|datenschutz|agb|widerruf|kontakt|service|hilfe|faq|newsletter)(\b|\/)/i;

/** Never let a single hung page (page.evaluate has no timeout) stall the suite. */
function withTimeout<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
  });
  return Promise.race([task, guard]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/** All known category landing slugs — these are NOT products themselves. */
const CATEGORY_SLUGS = new Set([
  'laufband', 'bikes-ergometer', 'rudergeraet', 'krafttraining', 'crosstrainer',
  'vibrationsplatte', 'zubehoer', 'bundles', 'ergometer', 'heimtrainer', 'sale', 'angebote',
]);

/**
 * Decide whether a URL is a real PDP. A Sportstech PDP is a detail page nested
 * under some slug (e.g. /laufband/f37s, /ergometer/x100) — NOT a category landing,
 * and never a cart/checkout/account/sitemap/banner/asset URL. We deliberately do
 * NOT require the path to start with the current category slug, because Sportstech
 * nests some products under a different slug than the menu label (e.g. bikes are
 * under /ergometer, strength gear under its own slugs) — requiring a prefix match
 * silently dropped whole categories.
 */
function isProductUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (!isInternalUrl(url, appConfig.baseUrl)) return false;          // must be sportstech.de
  const path = u.pathname.replace(/\/+$/, '');                        // strip trailing slash
  if (!path) return false;                                           // home
  if (NON_PRODUCT.test(path)) return false;                          // cart/checkout/account/sitemap/...
  if (/\.(xml|pdf|jpg|jpeg|png|webp|gif|svg|css|js|ico)$/i.test(path)) return false;
  if (/[?&](p|page|order|properties|filter|sort)=/i.test(u.search)) return false; // listing/pagination params
  const segments = path.split('/').filter(Boolean);
  if (segments.length < 2) return false;                             // single segment = category/landing/top-level page
  if (CATEGORY_SLUGS.has(segments[segments.length - 1].toLowerCase())) return false; // ends on a category landing
  if (/^(seite|page|filter|p|sort|order)$/i.test(segments[segments.length - 1])) return false; // pagination/filter tail
  return true;
}

/** Scroll to the bottom to trigger lazy-load / infinite scroll, clicking any "load more". */
async function exhaustScroll(page: Page): Promise<void> {
  const loadMore = ['button:has-text("Mehr")', 'button:has-text("laden")', 'button:has-text("Load more")',
    'a:has-text("Mehr anzeigen")', '[class*="load-more"]', 'button[class*="more" i]'];
  let lastHeight = 0;
  let stable = 0;
  for (let i = 0; i < 30 && stable < 2; i += 1) {
    const height = await withTimeout(
      page.evaluate(async () => {
        window.scrollBy(0, window.innerHeight * 1.5);
        await new Promise((r) => setTimeout(r, 350));
        return document.body.scrollHeight;
      }),
      15_000, 'scroll step',
    ).catch(() => lastHeight);
    const more = await firstVisible(page, loadMore, 600);
    if (more) { await more.click({ timeout: 2000 }).catch(() => undefined); await page.waitForTimeout(600); }
    stable = height <= lastHeight ? stable + 1 : 0;
    lastHeight = height;
  }
  await page.evaluate(() => window.scrollTo({ top: 0 })).catch(() => undefined);
}

/** Collect candidate product links (card / image / title) + product names, in-page. */
async function collectLinks(page: Page): Promise<{ links: Array<{ href: string; name: string }>; cardsWithoutLinks: number }> {
  return withTimeout(page.evaluate((cardLinkSelectors: string[]) => {
    const cardSelectors = ['.product-box', '[class*="product-box"]', '.cms-listing-col', '.product--box', 'article[class*="product" i]', '.product'];
    const out: Array<{ href: string; name: string }> = [];
    let cardsWithoutLinks = 0;
    const nameOf = (root: Element): string => {
      const el = root.querySelector('.product-name, .product--title, [class*="product-name" i], [class*="title" i], h2, h3');
      const img = root.querySelector('img');
      return (el?.textContent || (img as HTMLImageElement | null)?.alt || '').trim().replace(/\s+/g, ' ');
    };
    const seen = new Set<Element>();
    for (const sel of cardSelectors) {
      for (const card of Array.from(document.querySelectorAll(sel))) {
        if (seen.has(card)) continue;
        seen.add(card);
        const anchors = Array.from(card.querySelectorAll('a[href]')) as HTMLAnchorElement[];
        if (!anchors.length) { cardsWithoutLinks += 1; continue; }
        // Prefer title link, then an anchor wrapping the image, then the action button / first link.
        const titleLink = anchors.find((a) => a.querySelector('h2, h3, [class*="title" i], [class*="product-name" i]'));
        const imageLink = anchors.find((a) => a.querySelector('img'));
        const chosen = titleLink || imageLink || anchors[0];
        if (chosen?.href) out.push({ href: chosen.href, name: nameOf(card) });
      }
    }
    // Generic fallback: project's known product-link selectors.
    for (const a of Array.from(document.querySelectorAll(cardLinkSelectors.join(','))) as HTMLAnchorElement[]) {
      const href = a.href || (a.closest('a') as HTMLAnchorElement | null)?.href || '';
      if (href) out.push({ href, name: (a.textContent || '').trim().replace(/\s+/g, ' ') });
    }
    return { links: out, cardsWithoutLinks };
  }, SELECTORS.productLink), 20_000, 'collect links').catch(() => ({ links: [], cardsWithoutLinks: 0 }));
}

/** Find a "next page" URL for classic pagination, if any. (Valid CSS only — runs in-page.) */
async function nextPageUrl(page: Page): Promise<string | null> {
  const href = await page.evaluate(() => {
    const direct = document.querySelector(
      'link[rel="next"], a[rel="next"], a[aria-label*="next" i], a[aria-label*="nächste" i], a.pagination-nav__link--next',
    ) as HTMLAnchorElement | HTMLLinkElement | null;
    if (direct && 'href' in direct && direct.href) return direct.href;
    // Fall back to text-matching within pagination containers only.
    const words = ['nächste', 'weiter', 'next', '›', '»'];
    const containers = Array.from(document.querySelectorAll('[class*="pagination" i], nav[aria-label*="pag" i], ul[class*="page" i]'));
    for (const container of containers) {
      for (const a of Array.from(container.querySelectorAll('a[href]')) as HTMLAnchorElement[]) {
        const t = (a.textContent || '').trim().toLowerCase();
        if (t && words.some((w) => t === w || t.includes(w))) return a.href;
      }
    }
    return null;
  }).catch(() => null);
  return href;
}

async function gotoResilient(page: Page, url: string): Promise<number | null> {
  let res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null);
  if (!res) res = await page.goto(url, { waitUntil: 'commit', timeout: 25_000 }).catch(() => null);
  await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => undefined);
  return res ? res.status() : null;
}

test.describe('@pdp-discovery PDP discovery & validation', () => {
  test('discover and validate all PDP URLs across product categories', async ({ page, browser, dismissOverlays: dismiss, issueSink }) => {
    const validateOn = process.env.PDP_VALIDATE === '1';
    test.setTimeout(Number(process.env.PDP_TIMEOUT_MS ?? (validateOn ? 45 : 20) * 60 * 1000));
    const base = appConfig.baseUrl.replace(/\/+$/, '');
    const maxPages = Number(process.env.PDP_MAX_PAGES_PER_CATEGORY ?? 10);

    const categories: PdpCategoryResult[] = [];

    // ---- Discovery ------------------------------------------------------------
    for (const cat of CATEGORIES) {
      const categoryUrl = `${base}${cat.path}`;
      const rawLinks: Array<{ href: string; name: string }> = [];
      let cardsWithoutLinks = 0;
      let pagesWalked = 0;
      let scanFailed = false;
      let error: string | undefined;

      try {
        let current: string | null = categoryUrl;
        const visited = new Set<string>();
        while (current && pagesWalked < maxPages && !visited.has(current)) {
          visited.add(current);
          const status = await gotoResilient(page, current);
          if (pagesWalked === 0 && (status === null || status >= 400)) {
            scanFailed = true; error = `Category page returned ${status ?? 'no response'}`; break;
          }
          await dismiss();
          await exhaustScroll(page);
          const { links, cardsWithoutLinks: missed } = await collectLinks(page);
          rawLinks.push(...links);
          cardsWithoutLinks += missed;
          pagesWalked += 1;
          const next = await nextPageUrl(page);
          current = next && !visited.has(next) ? next : null;
        }
      } catch (err) {
        scanFailed = true;
        error = err instanceof Error ? err.message : String(err);
      }

      // Validate + de-duplicate this category's URLs.
      const valid = rawLinks
        .map((l) => ({ name: l.name, url: normalizeUrl(l.href, appConfig.baseUrl) }))
        .filter((l): l is { name: string; url: string } => !!l.url && isProductUrl(l.url));
      const productsFound = valid.length;
      const byUrl = new Map<string, PdpProduct>();
      for (const v of valid) if (!byUrl.has(v.url)) byUrl.set(v.url, { name: v.name || slugName(v.url), url: v.url });
      const products = [...byUrl.values()];

      categories.push({
        name: cat.name, url: categoryUrl,
        productsFound, duplicatesRemoved: productsFound - products.length, finalCount: products.length,
        cardsWithoutLinks, pagesWalked, scanFailed, error, products,
      });

      log.info(`${cat.name.padEnd(18)} found=${String(productsFound).padStart(3)} dupes=${String(productsFound - products.length).padStart(3)} final=${String(products.length).padStart(3)}${scanFailed ? ' [SCAN FAILED]' : ''}`);

      if (scanFailed) {
        issueSink.push({ ...issue('ui', 'high', categoryUrl, `PDP discovery failed to scan category "${cat.name}".`, 'Verify the category page loads and renders product listings.', error), confidence: 80, failureCategory: 'Real Website Issue', codeFixNeeded: false, websiteFixNeeded: true });
      } else if (products.length === 0) {
        issueSink.push({ ...issue('ui', 'medium', categoryUrl, `No product links detected on category "${cat.name}".`, 'Confirm product cards expose anchor links (card/image/title).'), confidence: 70, failureCategory: 'Real Website Issue', codeFixNeeded: false, websiteFixNeeded: true });
      }
    }

    // ---- Write discovery artifacts immediately --------------------------------
    // The report is generated as soon as discovery finishes, BEFORE the slower
    // per-PDP validation, so it is always viewable even if validation is long or
    // interrupted. It is rewritten with broken-PDP results once validation ends.
    const buildReport = (brokenPdps: BrokenPdp[], validatedCount: number): PdpDiscoveryReport => ({
      generatedAt: new Date().toISOString(),
      baseUrl: appConfig.baseUrl,
      totalCategories: categories.length,
      totalProducts: categories.reduce((s, c) => s + c.finalCount, 0),
      totalDuplicatesRemoved: categories.reduce((s, c) => s + c.duplicatesRemoved, 0),
      missingProductLinks: categories.reduce((s, c) => s + c.cardsWithoutLinks, 0),
      failedCategoryScans: categories.filter((c) => c.scanFailed).length,
      validatedCount,
      categories,
      brokenPdps,
    });

    await writeArtifacts(buildReport([], 0));
    log.info('Discovery complete — report written to reports/pdp-discovery.{json,csv,html}.');

    // ---- Validation: visit each PDP (OPT-IN, bounded + progress-logged) -------
    // Deep per-PDP validation is slow (one navigation + several checks per page),
    // so it is opt-in. By default we deliver the URL inventory fast. Enable with
    // PDP_VALIDATE=1 to verify HTTP 200 · title · price · add-to-cart · image.
    const brokenPdps: BrokenPdp[] = [];
    let validatedCount = 0;
    if (validateOn) {
      const allProducts = dedupeAcross(categories);
      const limit = Number(process.env.PDP_VALIDATE_MAX ?? 0); // 0 = validate all
      const toValidate = limit > 0 ? allProducts.slice(0, limit) : allProducts;
      validatedCount = toValidate.length;
      log.info(`Validating ${toValidate.length} unique PDP(s)…`);
      const ctx = await browser.newContext();
      let done = 0;
      await mapLimit(toValidate, Number(process.env.PDP_CONCURRENCY ?? 6), async (item) => {
        const broken = await withTimeout(validatePdp(ctx, item.url, item.category), 60_000, `validate ${item.url}`)
          .catch((err): BrokenPdp => ({ url: item.url, category: item.category, reasons: [err instanceof Error ? err.message : String(err)] }));
        if (broken) brokenPdps.push(broken);
        done += 1;
        if (done % 10 === 0 || done === toValidate.length) {
          log.info(`Validated ${done}/${toValidate.length} PDP(s) · broken so far: ${brokenPdps.length}`);
        }
      });
      await ctx.close();

      for (const b of brokenPdps) {
        issueSink.push({ ...issue('journey', b.status && b.status >= 400 ? 'critical' : 'high', b.url, `Broken PDP (${b.category}): ${b.reasons.join(', ')}.`, 'Repair the product page — broken PDPs lose the sale.', `HTTP ${b.status ?? 'n/a'}`), funnelStage: 'product-view', confidence: 85, failureCategory: b.status && b.status >= 400 ? 'Real Website Issue' : 'Revenue Risk Issue', codeFixNeeded: false, websiteFixNeeded: true });
      }
    } else {
      log.info('PDP validation skipped (default). Set PDP_VALIDATE=1 to deep-check each PDP (HTTP/title/price/add-to-cart/image).');
    }

    // ---- Rewrite artifacts with validation results ----------------------------
    const report = buildReport(brokenPdps, validatedCount);
    await writeArtifacts(report);
    printConsoleSummary(report);

    // Auto-open the report listing every discovered PDP URL (skipped in CI/headless).
    if (process.env.PDP_OPEN !== '0') {
      await openReport(join(appConfig.reportsDir, 'pdp-discovery.html')).catch(() => undefined);
    }

    // The unit of record is the report, not a thrown assertion — but a total
    // discovery failure (no products at all) indicates a real problem.
    expect(report.totalProducts, 'No PDP URLs discovered across any category').toBeGreaterThan(0);
  });
});

/** Per-PDP validation: HTTP 200 · title · price · add-to-cart · image. Returns a BrokenPdp or null. */
async function validatePdp(ctx: BrowserContext, url: string, category: string): Promise<BrokenPdp | null> {
  const page = await ctx.newPage();
  installOverlayAutoDismiss(page);
  const reasons: string[] = [];
  let status: number | undefined;
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null);
    status = res?.status();
    if (!res || res.status() >= 400) reasons.push(`HTTP ${status ?? 'no response'}`);
    await dismissOverlays(page).catch(() => undefined);

    const title = (await page.title().catch(() => '')) || '';
    const hasTitleEl = await firstVisible(page, ['h1', '[class*="product-name" i]', '[class*="product--title" i]', '[itemprop="name"]'], 2000);
    if (!title.trim() && !hasTitleEl) reasons.push('missing title');

    if (!(await firstVisible(page, SELECTORS.price, 2000))) reasons.push('missing price');
    if (!(await firstVisible(page, SELECTORS.addToCart, 2000))) reasons.push('missing add-to-cart');
    if (!(await firstVisible(page, ['main img', '[class*="gallery" i] img', 'picture img', '[data-product] img'], 2000))) reasons.push('missing image');
  } catch (err) {
    reasons.push(err instanceof Error ? err.message : String(err));
  } finally {
    await page.close().catch(() => undefined);
  }
  return reasons.length ? { url, category, status, reasons } : null;
}

/** Bounded-concurrency worker pool (same pattern used by the media audit). */
async function mapLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length || 1) }, async () => {
    while (index < items.length) await worker(items[index++]);
  }));
}

/** Flatten to a globally-unique URL list (a product may appear in multiple categories). */
function dedupeAcross(categories: PdpCategoryResult[]): Array<{ url: string; category: string }> {
  const seen = new Set<string>();
  const out: Array<{ url: string; category: string }> = [];
  for (const c of categories) {
    for (const p of c.products) {
      if (seen.has(p.url)) continue;
      seen.add(p.url);
      out.push({ url: p.url, category: c.name });
    }
  }
  return out;
}

function slugName(url: string): string {
  try { return new URL(url).pathname.split('/').filter(Boolean).pop() ?? url; } catch { return url; }
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function writeArtifacts(report: PdpDiscoveryReport): Promise<void> {
  await ensureDir(appConfig.reportsDir);

  // A. JSON report (exact requested shape + extra context).
  const categoriesMap: Record<string, string[]> = {};
  for (const c of report.categories) categoriesMap[c.name] = c.products.map((p) => p.url);
  const json = {
    totalCategories: report.totalCategories,
    totalProducts: report.totalProducts,
    totalDuplicatesRemoved: report.totalDuplicatesRemoved,
    failedCategoryScans: report.failedCategoryScans,
    brokenPdps: report.brokenPdps,
    categories: categoriesMap,
  };
  await writeJson(join(appConfig.reportsDir, 'pdp-discovery.json'), json);

  // B. CSV report: Category, Product Name, Product URL.
  const rows = ['Category,Product Name,Product URL'];
  for (const c of report.categories) for (const p of c.products) rows.push(`${csvCell(c.name)},${csvCell(p.name)},${csvCell(p.url)}`);
  await writeFile(join(appConfig.reportsDir, 'pdp-discovery.csv'), `${rows.join('\n')}\n`, 'utf8');

  // C. Dashboard HTML (peer report, rendered to PDF by the existing renderer).
  await writeFile(join(appConfig.reportsDir, 'pdp-discovery.html'), buildPdpDiscoveryReportHtml(report), 'utf8');

  // Run-scoped copies so artifacts are retained per run alongside the revenue run.
  const runDir = join(revenueRunDir(), 'pdp-discovery');
  await ensureDir(runDir);
  await writeJson(join(runDir, 'pdp-discovery.json'), report);
}

function printConsoleSummary(report: PdpDiscoveryReport): void {
  log.info('──── PDP Discovery Summary ────');
  // Console table: Category Name | Products Found | Duplicates Removed | Final Count.
  // eslint-disable-next-line no-console
  console.table(report.categories.map((c) => ({
    'Category Name': c.name,
    'Products Found': c.productsFound,
    'Duplicates Removed': c.duplicatesRemoved,
    'Final Count': c.finalCount,
  })));
  log.info(`Total categories: ${report.totalCategories} · Total PDPs: ${report.totalProducts} · Duplicates removed: ${report.totalDuplicatesRemoved}`);
  log.info(`Failed category scans: ${report.failedCategoryScans} · Missing product links: ${report.missingProductLinks} · Broken PDPs: ${report.brokenPdps.length}/${report.validatedCount} validated`);
  log.info('Reports: reports/pdp-discovery.json · reports/pdp-discovery.csv · reports/pdp-discovery.html');
}
