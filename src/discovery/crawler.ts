import { chromium, request as pwRequest, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { contextOptionsWithAuth, createAuthenticatedContext, authEnabled, looksLikeAuthRedirect } from '../auth/auth.js';
import { appConfig } from '../config.js';
import { dismissOverlays, installOverlayAutoDismiss } from '../engine/overlayGuard.js';
import type { DiscoveredPage, WebsiteMap } from '../types.js';
import { readJson, writeJson } from '../utils/fs.js';
import { createLogger } from '../utils/logger.js';
import { categorizeUrl, isIgnoredPath, isInternalUrl, normalizeUrl } from '../utils/url.js';
import { writeWebsiteMapHtml } from '../reports/html.js';

const log = createLogger('crawler');

async function dismissCommonPopups(page: Page): Promise<void> {
  // Centralized overlay guard (CMP selectors + DE/EN accept labels + frames + close fallbacks).
  await dismissOverlays(page).catch(() => undefined);
}

async function revealNavigation(page: Page): Promise<void> {
  const candidates = page.locator('header a, header button, nav a, nav button, [aria-haspopup="true"], [aria-expanded]');
  const count = Math.min(await candidates.count().catch(() => 0), 12);

  for (let index = 0; index < count; index += 1) {
    const item = candidates.nth(index);
    await item.hover({ timeout: 300 }).catch(() => undefined);
    const expanded = await item.getAttribute('aria-expanded').catch(() => null);
    if (expanded === 'false') {
      await item.click({ timeout: 300 }).catch(() => undefined);
    }
  }
}

async function inspectPage(page: Page, url: string, depth: number, status?: number): Promise<DiscoveredPage> {
  return page.evaluate(({ currentUrl, currentDepth, currentStatus }) => {
    const absolute = (value: string | null) => {
      if (!value) return null;
      try {
        return new URL(value, location.href).toString();
      } catch {
        return null;
      }
    };

    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
      .map((anchor) => absolute(anchor.getAttribute('href')))
      .filter((value): value is string => Boolean(value));

    const images = [
      ...Array.from(document.querySelectorAll<HTMLImageElement>('img')).map((image) => image.currentSrc || image.src),
      ...Array.from(document.querySelectorAll<HTMLElement>('*')).flatMap((element) => {
        const bg = getComputedStyle(element).backgroundImage;
        const match = bg.match(/url\(["']?(.+?)["']?\)/);
        return match?.[1] ? [absolute(match[1])].filter((value): value is string => Boolean(value)) : [];
      })
    ];

    return {
      url: currentUrl,
      title: document.title,
      depth: currentDepth,
      status: currentStatus,
      links: Array.from(new Set(links)),
      images: Array.from(new Set(images.filter(Boolean))),
      forms: document.querySelectorAll('form').length,
      buttons: document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]').length,
      inputs: document.querySelectorAll('input, textarea, select').length,
      navigationLabels: Array.from(document.querySelectorAll('header a, header button, nav a, nav button, footer a'))
        .map((node) => (node.textContent ?? '').trim())
        .filter(Boolean)
        .slice(0, 120),
      dynamicElements: {
        accordions: document.querySelectorAll('[aria-expanded], details, .accordion').length,
        tabs: document.querySelectorAll('[role="tab"], .tab').length,
        dialogs: document.querySelectorAll('dialog, [role="dialog"], .modal, .popup').length,
        carousels: document.querySelectorAll('[class*="carousel"], [class*="slider"], swiper-container, .swiper').length,
        videos: document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"]').length,
        languageSwitchers: document.querySelectorAll('[hreflang], [class*="language"], [class*="locale"]').length
      }
    };
  }, { currentUrl: url, currentDepth: depth, currentStatus: status });
}

/** Seed URLs: homepage + optional sitemap (SEED_SITEMAP=auto|url) + custom list (SEED_URLS=a,b,c). */
async function collectSeeds(baseUrl: string): Promise<string[]> {
  const seeds = [baseUrl];

  const sitemapSetting = process.env.SEED_SITEMAP ?? 'auto';
  if (sitemapSetting !== 'off') {
    const sitemapUrl = sitemapSetting === 'auto' ? `${new URL(baseUrl).origin}/sitemap.xml` : sitemapSetting;
    const api = await pwRequest.newContext({ ignoreHTTPSErrors: true });
    try {
      const response = await api.get(sitemapUrl, { timeout: 15_000 }).catch(() => null);
      if (response && response.status() < 400) {
        const xml = await response.text();
        const locs = [...xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/g)].map((match) => match[1]);
        // sitemap index → fetch first-level child sitemaps too
        const childSitemaps = locs.filter((loc) => /sitemap.*\.xml/i.test(loc)).slice(0, 10);
        const pageLocs = locs.filter((loc) => !/\.xml$/i.test(loc));
        for (const child of childSitemaps) {
          const childResponse = await api.get(child, { timeout: 15_000 }).catch(() => null);
          if (childResponse && childResponse.status() < 400) {
            pageLocs.push(...[...(await childResponse.text()).matchAll(/<loc>\s*(.*?)\s*<\/loc>/g)].map((match) => match[1]).filter((loc) => !/\.xml$/i.test(loc)));
          }
        }
        log.info(`Sitemap seeding: ${pageLocs.length} URL(s) from ${sitemapUrl}`);
        seeds.push(...pageLocs);
      }
    } finally {
      await api.dispose();
    }
  }

  if (process.env.SEED_URLS) {
    seeds.push(...process.env.SEED_URLS.split(',').map((url) => url.trim()).filter(Boolean));
  }
  return seeds;
}

/** Stable content fingerprint for change detection between runs. */
function contentHashOf(page: DiscoveredPage): string {
  return createHash('sha1')
    .update(JSON.stringify({ t: page.title, l: page.links.length, i: page.images.length, f: page.forms, b: page.buttons }))
    .digest('hex').slice(0, 16);
}

async function loadPreviousMap(): Promise<Map<string, string>> {
  const path = join(appConfig.reportsDir, 'website-map.json');
  if (!existsSync(path)) return new Map();
  const previous = await readJson<WebsiteMap>(path).catch(() => null);
  return new Map((previous?.pages ?? []).map((page) => [page.url, page.contentHash ?? '']));
}

/**
 * Concurrent BFS crawl.
 *   CRAWL_CONCURRENCY (default 4) parallel tabs share one queue — ~4x faster discovery.
 *   Change detection: content hashes vs the previous website-map.json set page.changed.
 *   INCREMENTAL=1 → downstream validation (pageList) processes changed pages first.
 *   Auth: when AUTH_MODE is configured, crawls with the authenticated storage state and
 *   flags pages that redirect anonymous users to login as requiresAuth.
 */
export async function crawlWebsite(baseUrl = appConfig.baseUrl): Promise<WebsiteMap> {
  const startedAt = Date.now();
  const browser: Browser = await chromium.launch();
  const context: BrowserContext = authEnabled()
    ? await createAuthenticatedContext(browser)
    : await browser.newContext({ ignoreHTTPSErrors: true, ...contextOptionsWithAuth() });

  const previousHashes = await loadPreviousMap();
  const queue: Array<{ url: string; depth: number }> = [];
  const seen = new Set<string>();
  const pages: DiscoveredPage[] = [];

  for (const seed of await collectSeeds(baseUrl)) {
    const normalized = normalizeUrl(seed, baseUrl);
    if (normalized && !seen.has(normalized) && isInternalUrl(normalized, baseUrl) && !isIgnoredPath(normalized, appConfig.ignoredPaths)) {
      seen.add(normalized);
      queue.push({ url: normalized, depth: 0 });
    }
  }

  const concurrency = Math.max(1, Number(process.env.CRAWL_CONCURRENCY ?? 4));
  let active = 0;

  async function worker(page: Page): Promise<void> {
    while (pages.length < appConfig.maxPages) {
      const next = queue.shift();
      if (!next) {
        if (active === 0) return;            // queue drained and nobody is producing
        await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }
      active += 1;
      const normalized = next.url;
      let responseStatus: number | undefined;
      try {
        const response = await page.goto(normalized, { waitUntil: 'domcontentloaded', timeout: appConfig.requestTimeoutMs });
        responseStatus = response?.status();
        await dismissCommonPopups(page);
        await revealNavigation(page);
        await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined);
        const discovered = await inspectPage(page, normalized, next.depth, responseStatus);
        discovered.category = categorizeUrl(normalized, baseUrl);
        discovered.requiresAuth = looksLikeAuthRedirect(page.url(), normalized);
        discovered.contentHash = contentHashOf(discovered);
        discovered.changed = previousHashes.size === 0 || previousHashes.get(normalized) !== discovered.contentHash;
        if (pages.length < appConfig.maxPages) pages.push(discovered);

        if (next.depth < appConfig.crawlDepth) {
          for (const href of discovered.links) {
            const candidate = normalizeUrl(href, baseUrl);
            if (candidate && !seen.has(candidate) && isInternalUrl(candidate, baseUrl) && !isIgnoredPath(candidate, appConfig.ignoredPaths)) {
              seen.add(candidate);
              queue.push({ url: candidate, depth: next.depth + 1 });
            }
          }
        }
        if (pages.length % 25 === 0) log.info(`Crawled ${pages.length}/${appConfig.maxPages} pages, queue ${queue.length}`);
      } catch {
        pages.push({
          url: normalized,
          title: '',
          category: categorizeUrl(normalized, baseUrl),
          depth: next.depth,
          status: responseStatus,
          changed: true,
          links: [], images: [], forms: 0, buttons: 0, inputs: 0, navigationLabels: [],
          dynamicElements: { accordions: 0, tabs: 0, dialogs: 0, carousels: 0, videos: 0, languageSwitchers: 0 }
        });
      } finally {
        active -= 1;
      }
    }
  }

  const tabs = await Promise.all(Array.from({ length: concurrency }, () => context.newPage()));
  for (const tab of tabs) installOverlayAutoDismiss(tab);
  await Promise.all(tabs.map((tab) => worker(tab)));
  await browser.close();

  const changedCount = pages.filter((page) => page.changed).length;
  log.info(`Crawl finished: ${pages.length} pages in ${Math.round((Date.now() - startedAt) / 1000)}s (${concurrency} workers, ${changedCount} changed since last run).`);

  const map: WebsiteMap = {
    baseUrl,
    generatedAt: new Date().toISOString(),
    totalPages: pages.length,
    pages
  };

  await writeJson(join(appConfig.reportsDir, 'website-map.json'), map);
  await writeWebsiteMapHtml(map, join(appConfig.reportsDir, 'website-map.html'));
  return map;
}
