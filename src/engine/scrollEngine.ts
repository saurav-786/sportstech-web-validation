import type { Locator, Page, Request } from '@playwright/test';
import { join } from 'node:path';
import type { PagePosition, PageSection, ScrollMetrics, ValidationIssue } from '../types.js';
import { ensureDir } from '../utils/fs.js';
import { issue } from '../validators/common.js';
import { dismissOverlays } from './overlayGuard.js';

export interface TraversalResult {
  metrics: ScrollMetrics;
  issues: ValidationIssue[];
}

// FAST_MODE=1 tightens every wait for quick local/CI runs (coverage unchanged).
const fast = process.env.FAST_MODE === '1';
const cfg = {
  stepFraction: Number(process.env.SCROLL_STEP_FRACTION ?? 0.9), // bigger steps = fewer iterations
  maxSteps: Number(process.env.SCROLL_MAX_STEPS ?? 30),
  stepDelayMs: Number(process.env.SCROLL_STEP_DELAY_MS ?? (fast ? 70 : 160)),
  bottomDwellMs: Number(process.env.SCROLL_BOTTOM_DWELL_MS ?? (fast ? 600 : 1_500)),
  topDwellMs: Number(process.env.SCROLL_TOP_DWELL_MS ?? (fast ? 150 : 350)),
  maxInteractions: Number(process.env.SCROLL_MAX_INTERACTIONS ?? (fast ? 2 : 3))
};

/**
 * MANDATORY full-page exploration. Every discovered page is driven through a complete
 * TOP → BOTTOM → TOP cycle before any page-specific test runs. Steps 1–17 of the spec:
 * load + network idle → top screenshot → gradual incremental scroll down (dwelling so
 * lazy images / dynamic sections / videos / widgets render) → bottom dwell 3–5s →
 * lazy-load verification + bottom screenshot → gradual scroll up → stabilize →
 * final top screenshot. Records depth, height, lazy assets, new/failed network
 * requests, failed renders, infinite-scroll + dynamic-injection detection, and
 * classifies every finding by page position (above-fold / mid / near-footer / footer / lazy).
 */
export async function traversePage(page: Page, pageUrl: string, screenshotDir: string): Promise<TraversalResult> {
  await ensureDir(screenshotDir);
  const startedAt = Date.now();
  const issues: ValidationIssue[] = [];
  const errorsWhileScrolling: string[] = [];

  // --- Network + console instrumentation scoped to the traversal window ---
  let newRequests = 0;
  let failedRequests = 0;
  const onRequest = () => { newRequests += 1; };
  const onRequestFailed = (request: Request) => {
    failedRequests += 1;
    errorsWhileScrolling.push(`Network fail: ${request.method()} ${request.url().slice(0, 120)} (${request.failure()?.errorText ?? 'unknown'})`);
  };
  const onConsoleError = (message: { type: () => string; text: () => string }) => {
    if (message.type() === 'error') errorsWhileScrolling.push(`Console: ${message.text().slice(0, 160)}`);
  };
  page.on('request', onRequest);
  page.on('requestfailed', onRequestFailed);
  page.on('console', onConsoleError as never);

  try {
    // 1+2. Page load + (capped) network idle, then clear any cookie/consent overlay
    await page.waitForLoadState('load', { timeout: 12_000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined);
    await dismissOverlays(page).catch(() => undefined);

    const before = await pageStats(page);
    const requestsBaseline = newRequests;

    // 3. Initial (top) screenshot
    const screenshotTop = join(screenshotDir, 'scroll-1-top.png');
    await page.screenshot({ path: screenshotTop, fullPage: false }).catch(() => undefined);

    // 4–7. Gradual incremental scroll TOP → BOTTOM
    let maxScrollTop = 0;
    let heightHistory: number[] = [before.height];
    let bottomReached = false;
    let dynamicSectionsRevealed = 0;
    let lastDomNodes = before.domNodes;

    for (let step = 0; step < cfg.maxSteps; step += 1) {
      // Scroll + read state + dynamic-node count in ONE round-trip (fewer evaluate calls).
      const state = await page.evaluate((fraction) => {
        const el = document.scrollingElement ?? document.documentElement;
        el.scrollBy({ top: window.innerHeight * fraction, behavior: 'auto' });
        return {
          scrollTop: el.scrollTop, height: el.scrollHeight, viewport: window.innerHeight,
          atBottom: el.scrollTop + window.innerHeight >= el.scrollHeight - 60,
          nodes: document.querySelectorAll('*').length
        };
      }, cfg.stepFraction).catch(() => null);
      if (!state) break;

      // Short pause lets lazy content / widgets render (no blocking network-idle per step).
      await page.waitForTimeout(cfg.stepDelayMs);

      maxScrollTop = Math.max(maxScrollTop, state.scrollTop);
      heightHistory.push(state.height);
      if (state.nodes > lastDomNodes + 15) dynamicSectionsRevealed += 1;
      lastDomNodes = state.nodes;

      if (state.atBottom) {
        const stable = heightHistory.slice(-3);
        if (stable.length >= 2 && stable.every((value) => value === stable[0])) { bottomReached = true; break; }
      }
    }

    // 8. Brief dwell at the bottom for final lazy assets (one network-idle settle).
    await page.evaluate(() => (document.scrollingElement ?? document.documentElement).scrollTo({ top: (document.scrollingElement ?? document.documentElement).scrollHeight, behavior: 'auto' })).catch(() => undefined);
    await page.waitForTimeout(cfg.bottomDwellMs);
    await page.waitForLoadState('networkidle', { timeout: 1_500 }).catch(() => undefined);

    // Interact with revealed CONTENT expandables only (FAQ/accordion). Deliberately scoped
    // to content regions and excludes header/nav toggles, search, cart, menu, and anything
    // that opens a dialog/drawer overlay (those obscure the page and skew screenshots).
    let hiddenContentRevealed = 0;
    if (cfg.maxInteractions > 0) {
      const expandables = page.locator([
        'main details:not([open]) summary',
        'article details:not([open]) summary',
        '[class*="accordion" i] [aria-expanded="false"]:not([aria-haspopup])',
        '[class*="faq" i] [aria-expanded="false"]:not([aria-haspopup])',
        '[class*="collaps" i] [aria-expanded="false"]:not([aria-haspopup])'
      ].join(', '));
      const interactCount = Math.min(await expandables.count().catch(() => 0), cfg.maxInteractions);
      for (let index = 0; index < interactCount; index += 1) {
        const target = expandables.nth(index);
        if (await isOverlayTrigger(target)) continue; // skip search/menu/cart/login toggles
        const clicked = await target.click({ timeout: 1_500 }).then(() => true).catch(() => false);
        if (clicked) { hiddenContentRevealed += 1; await page.waitForTimeout(200); }
      }
    }

    // Close anything inadvertently opened (search/drawer) before the bottom shot and scroll-up.
    await closeStrayOverlays(page);
    await dismissOverlays(page).catch(() => undefined);

    const afterBottom = await pageStats(page);

    // 9. Verify lazy-loaded elements appeared / detect failures
    const newlyBroken = Math.max(0, afterBottom.brokenImages - before.brokenImages);
    const lazyImagesPending = afterBottom.lazyPending;

    // 10. Bottom screenshot (full page now that everything has loaded)
    const screenshotBottom = join(screenshotDir, 'scroll-2-bottom.png');
    await page.screenshot({ path: screenshotBottom, fullPage: true }).catch(() => undefined);

    // 12–14. Gradual scroll BOTTOM → TOP (faster than the downward pass; content already loaded).
    for (let step = 0; step < cfg.maxSteps; step += 1) {
      const top = await page.evaluate((fraction) => {
        const el = document.scrollingElement ?? document.documentElement;
        el.scrollBy({ top: -window.innerHeight * fraction, behavior: 'auto' });
        return el.scrollTop;
      }, cfg.stepFraction).catch(() => 0);
      await page.waitForTimeout(Math.round(cfg.stepDelayMs * 0.35));
      if (top <= 5) break;
    }

    // 15. Stabilize at top, then close any stray overlay (search/drawer) so the final shot is clean.
    await page.evaluate(() => (document.scrollingElement ?? document.documentElement).scrollTo({ top: 0, behavior: 'smooth' })).catch(() => undefined);
    await closeStrayOverlays(page);
    await page.waitForTimeout(cfg.topDwellMs);

    // 16. Final top screenshot
    const screenshotFinalTop = join(screenshotDir, 'scroll-3-final-top.png');
    await page.screenshot({ path: screenshotFinalTop, fullPage: false }).catch(() => undefined);

    // --- Derive metrics ---
    const totalHeight = afterBottom.height;
    const viewport = before.viewport || 900;
    const scrollDepthPx = Math.min(maxScrollTop + viewport, totalHeight);
    const scrollDepthPercent = totalHeight > 0 ? Math.min(100, Math.round((scrollDepthPx / totalHeight) * 100)) : 0;
    const infiniteScroll = !bottomReached && totalHeight > before.height * 2;
    const lazyAssetsFound = Math.max(0, afterBottom.images - before.images);
    const imagesLoadedDuringScroll = Math.max(0, afterBottom.loadedImages - before.loadedImages);

    // --- Position-classified issues ---
    const classify = (scrollTopAtDetection: number): PagePosition =>
      positionFor(scrollTopAtDetection, viewport, totalHeight);

    if (newlyBroken > 0) {
      issues.push(withPosition(issue('image', 'high', pageUrl, `${newlyBroken} lazy-loaded image(s) failed to render during scroll.`, 'Fix data-src/srcset or CDN paths for below-the-fold imagery.'), 'lazy-loaded', sectionForUrl(pageUrl)));
    }
    if (lazyImagesPending > 0) {
      issues.push(withPosition(issue('image', 'medium', pageUrl, `${lazyImagesPending} image(s) still unloaded after reaching the bottom.`, 'Lower the lazy-load threshold or preload critical media.'), 'lazy-loaded', 'content'));
    }
    if (failedRequests > 0) {
      issues.push(withPosition(issue('ui', 'high', pageUrl, `${failedRequests} network request(s) failed while scrolling.`, 'Inspect failed XHR/fetch and asset URLs triggered on scroll.', errorsWhileScrolling.filter((entry) => entry.startsWith('Network')).slice(0, 5).join('\n')), classify(maxScrollTop), 'content'));
    }
    if (infiniteScroll) {
      issues.push(withPosition(issue('ui', 'info', pageUrl, 'Infinite-scroll behavior detected (height kept growing).', 'Provide a paginated fallback for SEO and accessibility; cap automated scroll depth.'), 'footer', 'product-listing'));
    }
    const animationIssues = await detectAnimationIssues(page).catch(() => 0);
    if (animationIssues > 0) {
      issues.push(withPosition(issue('responsive', 'low', pageUrl, `${animationIssues} element(s) appear stuck mid-animation or off-screen after scroll.`, 'Verify scroll-triggered animations complete and reserve layout space.'), 'mid-page', 'content'));
    }

    const metrics: ScrollMetrics = {
      pageUrl,
      pageTitle: await page.title().catch(() => ''),
      totalHeightPx: totalHeight,
      viewportHeightPx: viewport,
      scrollCompleted: bottomReached || scrollDepthPercent >= 95,
      scrollDepthPx,
      scrollDepthPercent,
      bottomReached,
      infiniteScroll,
      lazyContentDetected: lazyAssetsFound > 0 || imagesLoadedDuringScroll > 0,
      dynamicSectionsRevealed,
      hiddenContentRevealed,
      lazyAssetsFound,
      imagesLoadedDuringScroll,
      newNetworkRequests: Math.max(0, newRequests - requestsBaseline),
      failedNetworkRequests: failedRequests,
      failedRenders: newlyBroken + lazyImagesPending,
      animationIssues,
      errorsWhileScrolling: errorsWhileScrolling.slice(0, 25),
      screenshotTop,
      screenshotBottom,
      screenshotFinalTop,
      durationMs: Date.now() - startedAt
    };

    return { metrics, issues };
  } finally {
    page.off('request', onRequest);
    page.off('requestfailed', onRequestFailed);
    page.off('console', onConsoleError as never);
  }
}

/** True if a control would open search/menu/cart/login/etc. (should not be clicked during traversal). */
async function isOverlayTrigger(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const haspopup = el.getAttribute('aria-haspopup');
    if (haspopup && haspopup !== 'false') return true;
    if (el.closest('header, nav, [role="banner"], [role="navigation"], [class*="header" i], [class*="nav" i]')) return true;
    const name = `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''} ${(el.textContent ?? '').trim()} ${el.className} ${el.id}`;
    return /search|suche|menu|menü|cart|warenkorb|basket|login|anmelden|account|konto|filter|sortier|sort|language|sprache|locale|wishlist|merkliste|chat/i.test(name);
  }).catch(() => true); // on error, treat as unsafe and skip
}

/** Close any open search box, side drawer, or modal (Escape + targeted close affordances). */
async function closeStrayOverlays(page: Page): Promise<void> {
  // Collapse expanded header/search/menu toggles.
  const openToggles = page.locator('header [aria-expanded="true"], nav [aria-expanded="true"], [aria-haspopup][aria-expanded="true"]');
  const count = Math.min(await openToggles.count().catch(() => 0), 4);
  for (let i = 0; i < count; i += 1) {
    await openToggles.nth(i).click({ timeout: 800 }).catch(() => undefined);
  }
  // Escape closes most search overlays / drawers / dialogs.
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(150);
  // Click outside any open drawer/search panel to dismiss click-away overlays.
  const stray = page.locator('[class*="drawer" i][class*="open" i], [class*="offcanvas" i].show, [class*="search" i][aria-expanded="true"], [aria-modal="true"]');
  if (await stray.first().isVisible().catch(() => false)) {
    await page.mouse.click(5, Math.round((await page.evaluate(() => window.innerHeight).catch(() => 600)) / 2)).catch(() => undefined);
    await page.keyboard.press('Escape').catch(() => undefined);
  }
}

/** Map a scroll offset to a page region for AI position classification. */
function positionFor(scrollTop: number, viewport: number, totalHeight: number): PagePosition {
  if (totalHeight <= 0) return 'unknown';
  const ratio = (scrollTop + viewport / 2) / totalHeight;
  if (ratio <= 0.25) return 'above-fold';
  if (ratio <= 0.7) return 'mid-page';
  if (ratio <= 0.9) return 'near-footer';
  return 'footer';
}

/** Heuristic section inference from URL category — drives defect priority boosts. */
function sectionForUrl(url: string): PageSection {
  const path = url.toLowerCase();
  if (/checkout|kasse|payment/.test(path)) return 'checkout';
  if (/abo|subscription|membership/.test(path)) return 'subscription';
  if (/preis|price|pricing|angebot|sale/.test(path)) return 'pricing';
  if (/product|produkt|laufband|ergometer|rudergeraet|krafttraining|bikes/.test(path)) return 'product-listing';
  if (path.endsWith('/') || /home|start/.test(path)) return 'hero';
  return 'content';
}

function withPosition(base: ValidationIssue, position: PagePosition, section: PageSection): ValidationIssue {
  return { ...base, pagePosition: position, pageSection: section };
}

async function detectAnimationIssues(page: Page): Promise<number> {
  return page.evaluate(() => {
    let stuck = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[class*="animate"], [class*="fade"], [data-aos]'))) {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      // visible in DOM but rendered with 0 opacity or shifted far off-screen after scroll
      if ((Number(style.opacity) === 0 && rect.width > 0) || rect.left > window.innerWidth + 200) stuck += 1;
    }
    return stuck;
  });
}

async function pageStats(page: Page): Promise<{ images: number; loadedImages: number; brokenImages: number; lazyPending: number; resources: number; height: number; viewport: number; domNodes: number }> {
  return page.evaluate(() => {
    const images = Array.from(document.querySelectorAll<HTMLImageElement>('img'));
    const withSrc = images.filter((img) => img.currentSrc || img.src || img.getAttribute('data-src'));
    return {
      images: images.length,
      loadedImages: images.filter((img) => img.complete && img.naturalWidth > 0).length,
      brokenImages: images.filter((img) => img.complete && img.naturalWidth === 0 && (img.currentSrc || img.src)).length,
      lazyPending: withSrc.filter((img) => !img.complete || (img.loading === 'lazy' && img.naturalWidth === 0)).length,
      resources: performance.getEntriesByType('resource').length,
      height: (document.scrollingElement ?? document.documentElement).scrollHeight,
      viewport: window.innerHeight,
      domNodes: document.querySelectorAll('*').length
    };
  }).catch(() => ({ images: 0, loadedImages: 0, brokenImages: 0, lazyPending: 0, resources: 0, height: 0, viewport: 900, domNodes: 0 }));
}
