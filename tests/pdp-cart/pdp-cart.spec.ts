/**
 * pdp-cart.spec.ts — @pdp-cart-fast suite (FAST, stable add-to-cart validation).
 *
 * Goal: validate add-to-cart for EVERY discovered PDP, fast and stable, across the
 * configured device matrix.
 *
 * Architecture:
 *   • Device profile = one Playwright PROJECT (playwright.config.ts → pdpCartProjects,
 *     active when PDP_CART=1). The runner owns browser launch, parallelism, --headed.
 *   • One test per PDP URL → multiplied by projects = device × URL coverage, run in
 *     parallel across workers (test.describe.configure mode: 'parallel').
 *   • WARM CONTEXT PER WORKER: this site has a ~12s per-context cold-start tax
 *     (first navigation in a fresh context), but warm loads are ~2–3s. So instead of
 *     a fresh context per test, each worker reuses ONE context (pre-warmed against the
 *     home page) and opens a fresh PAGE per test. ~5x faster. Cart is shared across a
 *     worker's tests — fine for add-to-cart validation (each add still updates the
 *     mini-cart/count).
 *   • Tracing on the reused context uses start() once per worker + start/stopChunk()
 *     per test — the correct API for a long-lived context (this is what fixes the
 *     "Must start tracing before starting a new chunk" error). Trace + screenshot are
 *     retained only on failure.
 *
 * Speed/stability levers: resource blocking (images/fonts/media/analytics/trackers),
 * locator-based waits only (domcontentloaded + expect visible/enabled — no networkidle,
 * no waitForTimeout), per-URL timeout, retries + backoff + jitter for transient latency.
 *
 * Scope = add-to-cart only:
 *   1. PDP loads (HTTP < 400)  2. ATC visible  3. ATC enabled
 *   4. Product added (click)   5. Cart drawer/mini-cart/count reflects it
 *
 *   npm run test:pdp-cart        # all devices, low concurrency
 *   npm run test:pdp-cart:fast   # FAST_MODE, 3 workers
 *   npm run test:pdp-cart:headed # FAST_MODE, headed, 1 worker
 */
import {
  test as base,
  expect,
  devices,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { appConfig } from '../../src/config.js';
import { firstVisible, SELECTORS } from '../../src/journeys/common.js';
import { dismissOverlays, installOverlayAutoDismiss } from '../../src/engine/overlayGuard.js';
import { loadPdpUrls } from './pdpUrls.js';

const FAST = process.env.FAST_MODE === 'true' || process.env.FAST_MODE === '1';
const TRACE = process.env.PDP_CART_TRACE ? process.env.PDP_CART_TRACE !== '0' : true;

// Locator-based waits only. Nav timeout is generous because of the cold-start tax
// and intermittent latency that can exceed 30s (that caused "page.goto Timeout 30000ms").
const NAV_TIMEOUT = Number(process.env.PDP_CART_NAV_TIMEOUT_MS ?? (FAST ? 30_000 : 45_000));
const ATC_VISIBLE_TIMEOUT = FAST ? 6_000 : 10_000;
const CONFIRM_TIMEOUT = FAST ? 5_000 : 8_000;
const PER_URL_TIMEOUT = Number(process.env.PDP_CART_URL_TIMEOUT_MS ?? (FAST ? 60_000 : 90_000));
// Resilience to transient latency.
const RETRIES = Number(process.env.PDP_CART_RETRIES ?? 2);
const RETRY_BACKOFF_MS = Number(process.env.PDP_CART_RETRY_BACKOFF_MS ?? 4_000);
const PACING_JITTER_MS = Number(process.env.PDP_CART_PACING_MS ?? 750);

const ALL_PRODUCTS = loadPdpUrls();
const MAX = Number(process.env.PDP_CART_MAX ?? 0); // 0 = all discovered PDPs
const PRODUCTS = MAX > 0 ? ALL_PRODUCTS.slice(0, MAX) : ALL_PRODUCTS;

// Device descriptor per project (used to build the worker's reused context).
const DEVICE_DESCRIPTORS: Record<string, (typeof devices)[string]> = {
  'desktop-chrome': devices['Desktop Chrome'],
  'desktop-safari': devices['Desktop Safari'],
  'ios-safari-iphone': devices['iPhone 15'],
  'android-phone': devices['Pixel 7'],
  'ios-ipad': devices['iPad (gen 7)'],
  'android-tablet': devices['Galaxy Tab S4'],
};

/** Device options minus keys newContext() doesn't accept (e.g. defaultBrowserType). */
function contextOptionsFor(projectName: string): Record<string, unknown> {
  const descriptor = DEVICE_DESCRIPTORS[projectName];
  if (!descriptor) return {};
  const { defaultBrowserType, ...rest } = descriptor;
  void defaultBrowserType;
  return rest;
}

// Add-to-cart confirmation: mini-cart / drawer / count / cart link appears or updates.
const CART_CONFIRM_SELECTORS = [
  '[class*="mini-cart" i]', '[class*="cart-count" i]', '[class*="added" i]',
  '[class*="offcanvas" i][class*="cart" i]', '[class*="drawer" i]',
  'a[href*="warenkorb"]', 'a[href*="checkout/cart"]', 'a[href*="cart"]',
];

// Resources that don't affect add-to-cart but cost time/bandwidth.
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);
const BLOCKED_URL = /google-analytics|googletagmanager|google\.com\/(pagead|ads)|googlesyndication|doubleclick|facebook\.(com|net)|connect\.facebook|hotjar|mouseflow|fullstory|clarity\.ms|segment\.(io|com)|criteo|taboola|outbrain|bing\.com\/bat|yandex|tiktok|snapchat|pinterest|\.ttf|\.woff2?|\.mp4|\.webm/i;

/** Keep only html/css/js/xhr/fetch (+ document); abort the rest. Applied at context level. */
async function blockUnneededResources(context: BrowserContext): Promise<void> {
  await context.route('**/*', (route) => {
    const request = route.request();
    if (BLOCKED_RESOURCE_TYPES.has(request.resourceType()) || BLOCKED_URL.test(request.url())) {
      return route.abort().catch(() => undefined);
    }
    return route.continue().catch(() => undefined);
  });
}

// ── Fixtures ────────────────────────────────────────────────────────────────
// warmContext: one reused, pre-warmed context per worker (built off the project's
// `browser`, so --headed is honoured natively). pdpPage: a fresh page per test from
// that warm context, with per-test trace chunk retained only on failure.
interface PdpTestFixtures {
  pdpPage: Page;
}
interface PdpWorkerFixtures {
  warmContext: BrowserContext;
}

const test = base.extend<PdpTestFixtures, PdpWorkerFixtures>({
  warmContext: [
    async ({ browser }, use, workerInfo) => {
      const context = await browser.newContext(contextOptionsFor(workerInfo.project.name));
      await blockUnneededResources(context);
      if (TRACE) await context.tracing.start({ screenshots: true, snapshots: true }).catch(() => undefined);

      // Warm up once: establish the connection + consent cookie so per-test loads are fast.
      const warm = await context.newPage();
      installOverlayAutoDismiss(warm);
      await warm.goto(appConfig.baseUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT }).catch(() => undefined);
      await dismissOverlays(warm).catch(() => undefined);
      await warm.close().catch(() => undefined);

      await use(context);

      if (TRACE) await context.tracing.stop().catch(() => undefined);
      await context.close().catch(() => undefined);
    },
    { scope: 'worker' },
  ],

  pdpPage: async ({ warmContext }, use, testInfo) => {
    const page = await warmContext.newPage();
    installOverlayAutoDismiss(page);
    if (TRACE) await warmContext.tracing.startChunk().catch(() => undefined);

    await use(page);

    // Teardown: retain screenshot + trace chunk only on failure; otherwise discard.
    const failed = testInfo.status !== testInfo.expectedStatus;
    if (failed) {
      const shot = testInfo.outputPath('failure.png');
      await page.screenshot({ path: shot, fullPage: false }).catch(() => undefined);
      await testInfo.attach('screenshot', { path: shot, contentType: 'image/png' }).catch(() => undefined);
    }
    if (TRACE) {
      if (failed) {
        const tracePath = testInfo.outputPath('trace.zip');
        await warmContext.tracing.stopChunk({ path: tracePath }).catch(() => undefined);
        await testInfo.attach('trace', { path: tracePath, contentType: 'application/zip' }).catch(() => undefined);
      } else {
        await warmContext.tracing.stopChunk().catch(() => undefined); // discard on success
      }
    }
    await page.close().catch(() => undefined);
  },
});

// Run all (device × URL) combinations in parallel across workers, with retries to ride
// out transient latency (a pass-on-retry is reported "flaky", not "passed").
test.describe.configure({ mode: 'parallel', retries: RETRIES });

test.describe('@pdp-cart-fast add-to-cart validation (all PDPs × devices)', () => {
  if (PRODUCTS.length === 0) {
    test('PDP URLs are available', () => {
      test.skip(true, 'No PDP URLs found. Run "npm run test:pdp-discovery" (then REFRESH_PDP_URLS=true) or set PDP_LIST.');
    });
    return;
  }

  for (const product of PRODUCTS) {
    // Title = URL; the device dimension comes from the Playwright project name.
    test(product.url, async ({ pdpPage: page }, testInfo) => {
      testInfo.setTimeout(PER_URL_TIMEOUT);
      testInfo.annotations.push({ type: 'pdp-device', description: testInfo.project.name });
      testInfo.annotations.push({ type: 'pdp-url', description: product.url });

      // Pace navigations: jitter avoids lockstep bursts; each retry backs off more.
      const waitMs = testInfo.retry * RETRY_BACKOFF_MS + Math.floor(Math.random() * PACING_JITTER_MS);
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));

      // 1. PDP loads successfully (DOM ready — not all sub-resources).
      const response = await page.goto(product.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      expect(response, `No HTTP response for ${product.url}`).toBeTruthy();
      expect(response!.status(), `PDP returned HTTP ${response!.status()}`).toBeLessThan(400);
      await dismissOverlays(page).catch(() => undefined);

      // 2 + 3. Add-to-cart button is visible and enabled.
      const atc = await firstVisible(page, SELECTORS.addToCart, ATC_VISIBLE_TIMEOUT);
      expect(atc, 'Add-to-cart button is not visible').not.toBeNull();
      await expect(atc!, 'Add-to-cart button is disabled (likely out of stock)').toBeEnabled({ timeout: 2_000 });

      // 4. Product can be added to cart.
      await dismissOverlays(page).catch(() => undefined);
      await atc!.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => undefined);
      await atc!.click({ timeout: 8_000 });

      // 5. Cart drawer / mini-cart / count reflects the added product.
      const confirmation = await firstVisible(page, CART_CONFIRM_SELECTORS, CONFIRM_TIMEOUT);
      expect(confirmation, 'Cart did not reflect the added product (no mini-cart/drawer/count update)').not.toBeNull();
    });
  }
});
