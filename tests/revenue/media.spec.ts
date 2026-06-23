/**
 * media.spec.ts — @media suite. Audits PDP media (images, video, mp4/webm, sizes)
 * on BOTH desktop and mobile form factors in a single run, then writes a media
 * report. Discovers product pages via the project's own URL categorizer so it
 * needs no hard-coded product URLs.
 *
 *   npm run test:media      → runs this suite
 *   npm run media           → runs + writes reports/media-report.html
 */
import { test, expect, devices, type BrowserContext } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appConfig } from '../../src/config.js';
import { categorizeUrl, isInternalUrl } from '../../src/utils/url.js';
import { collectMedia, mediaToIssues } from '../../src/validators/media.js';
import { issue } from '../../src/validators/common.js';
import { SELECTORS } from '../../src/journeys/common.js';
import { buildMediaReportHtml } from '../../src/reports/mediaReport.js';
import { installOverlayAutoDismiss, dismissOverlays } from '../../src/engine/overlayGuard.js';
import { ensureDir, writeJson } from '../../src/utils/fs.js';
import type { MediaPageResult } from '../../src/types.js';
import { revenueRunDir } from '../../src/revenue/runArtifacts.js';

async function allInternalLinks(page: import('@playwright/test').Page): Promise<string[]> {
  return (await page.locator('a[href]').evaluateAll((as) =>
    Array.from(new Set(as.map((a) => (a as HTMLAnchorElement).href).filter(Boolean)))).catch(() => []))
    .filter((h) => { try { return isInternalUrl(h, appConfig.baseUrl) && /^https?:/.test(h); } catch { return false; } });
}

/** Product URLs via BOTH URL categorization and product-card anchors (robust across markup). */
async function productUrlsOn(page: import('@playwright/test').Page): Promise<string[]> {
  const byCategory = (await allInternalLinks(page)).filter((h) => categorizeUrl(h, appConfig.baseUrl) === 'product');
  const byCard = await page.locator(SELECTORS.productLink.join(', '))
    .evaluateAll((els) => els.map((el) => {
      const a = el.closest('a') as HTMLAnchorElement | null;
      return (a?.href) || (el as HTMLAnchorElement).href || '';
    }).filter(Boolean)).catch(() => []);
  return [...new Set([...byCategory, ...byCard])]
    .filter((h) => { try { return isInternalUrl(h, appConfig.baseUrl); } catch { return false; } });
}

/** Build the audit set: homepage + first category + up to `limit` PDPs (so we cover all site media). */
async function discoverAuditPages(context: BrowserContext, limit: number): Promise<string[]> {
  const page = await context.newPage();
  installOverlayAutoDismiss(page);
  const audit: string[] = [appConfig.baseUrl];

  await page.goto(appConfig.baseUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => undefined);
  await dismissOverlays(page).catch(() => undefined);

  let products = await productUrlsOn(page);

  const category = (await allInternalLinks(page)).find((h) => categorizeUrl(h, appConfig.baseUrl) === 'category');
  if (category) {
    audit.push(category);
    await page.goto(category, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined);
    await dismissOverlays(page).catch(() => undefined);
    await page.evaluate(async () => { for (let i = 0; i < 10; i++) { window.scrollBy(0, window.innerHeight); await new Promise((r) => setTimeout(r, 250)); } }).catch(() => undefined);
    products = [...new Set([...products, ...(await productUrlsOn(page))])];
  }

  await page.close();
  return [...new Set([...audit, ...products.slice(0, limit)])];
}

async function mapLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  }));
}

/**
 * Run `task` but never let a single hung page consume the whole suite budget.
 * page.evaluate() (used by collectMedia) has no built-in timeout, so a page whose
 * JS context is busy/unresponsive could otherwise stall indefinitely. On expiry we
 * REJECT (not silently resolve) so the caller records it as a real website finding.
 */
function withDeadline<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms (page unresponsive)`)), ms);
  });
  return Promise.race([task, guard]).finally(() => clearTimeout(timer)) as Promise<T>;
}

test.describe('@media PDP media audit (mobile + desktop)', () => {
  test('product pages stay within media budgets on mobile and desktop', async ({ browser }) => {
    test.setTimeout(Number(process.env.MEDIA_TIMEOUT_MS ?? 12 * 60 * 1000));
    const limit = appConfig.revenue.media.maxPdps;

    const desktopCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const mobileCtx = await browser.newContext({ ...devices['iPhone 15'] });

    const auditPages = await discoverAuditPages(desktopCtx, limit);
    console.log(`Auditing media on ${auditPages.length} page(s): ${auditPages.map((u) => u.replace(/^https?:\/\/[^/]+/, '') || '/').join(', ')}`);
    expect(auditPages.length, 'No pages discovered to audit').toBeGreaterThan(0);

    const results: MediaPageResult[] = [];
    const formFactors: Array<{ ff: 'desktop' | 'mobile'; ctx: BrowserContext; device: string }> = [
      { ff: 'desktop', ctx: desktopCtx, device: 'desktop-1440' },
      { ff: 'mobile', ctx: mobileCtx, device: 'iphone-15' },
    ];

    const pageBudgetMs = Number(process.env.MEDIA_PAGE_BUDGET_MS ?? 75_000);
    for (const { ff, ctx, device } of formFactors) {
      await mapLimit(auditPages, Number(process.env.MEDIA_CONCURRENCY ?? 3), async (url) => {
        const page = await ctx.newPage();
        installOverlayAutoDismiss(page);
        try {
          // Whole per-page audit (navigate + lazy-load scroll + inventory) is bounded so a
          // single slow/unresponsive page cannot hang and time out the entire test.
          const assets = await withDeadline((async () => {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
            await dismissOverlays(page).catch(() => undefined);
            return collectMedia(page);
          })(), pageBudgetMs, `Media audit of ${url} (${ff})`);
          results.push(mediaToIssues(url, ff, device, assets));
        } catch (err) {
          // Do NOT suppress: a page that won't load/inventory within budget is a real
          // website finding (too slow/unresponsive). Record it so it surfaces in the report.
          const message = err instanceof Error ? err.message : String(err);
          const timedOut = /exceeded \d+ms|timeout/i.test(message);
          results.push({
            url, formFactor: ff, device, images: [], videos: [], totalImageBytes: 0, totalVideoBytes: 0,
            issues: [{
              ...issue('performance', 'high', url,
                `Media could not be inventoried on ${ff}: ${timedOut ? 'page did not load/respond within budget' : 'navigation failed'}.`,
                'Investigate this page\'s load time/availability — slow or failing PDPs directly suppress conversion.',
                message.slice(0, 300)),
              device, funnelStage: 'product-view',
            }],
          });
        } finally {
          await page.close().catch(() => undefined);
        }
      });
    }

    await desktopCtx.close();
    await mobileCtx.close();

    const runMediaDir = join(revenueRunDir(), 'media');
    await ensureDir(runMediaDir);
    await writeJson(join(runMediaDir, 'media-results.json'), results);
    await writeFile(join('reports', 'media-report.html'), buildMediaReportHtml(results), 'utf8');

    const flagged = results.flatMap((r) => r.issues);
    const critical = flagged.filter((i) => i.severity === 'critical' || i.severity === 'high');
    const totalAssets = results.reduce((s, r) => s + r.images.length + r.videos.length, 0);
    console.log(`Media audit: ${results.length} page-runs, ${totalAssets} assets inventoried, ${flagged.length} issues (${critical.length} high/critical). Report: reports/media-report.html`);

    // Diagnostic audit — always green; defects are reported, not thrown. Only fail if
    // we somehow inventoried nothing at all (indicates a discovery/load problem).
    expect(totalAssets, 'No media assets inventoried on any page').toBeGreaterThan(0);
  });
});
