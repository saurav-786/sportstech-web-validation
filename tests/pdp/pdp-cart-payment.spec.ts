/**
 * pdp-cart-payment.spec.ts — @pdp-cart suite.
 *
 * For EVERY PDP discovered by tests/pdp/pdp-discovery.spec.ts, drive the real
 * Sportstech purchase flow — add to cart → cart → guest checkout → PAYMENT PAGE —
 * across the full browser/device matrix:
 *
 *   desktop Chrome (chromium) · desktop Safari (webkit) · iOS Safari iPhone (webkit)
 *   · Android phone (chromium) · iPad tablet (webkit) · Android tablet (chromium)
 *
 * Boundary-safe: it reaches the payment page and verifies payment options render,
 * then STOPS — it never clicks "Zahlungspflichtig bestellen", so no real order is
 * placed (the reference flow's final click is intentionally not performed).
 *
 * Reuses the existing journey engine — no duplicate logic:
 *   validatePdp (add-to-cart) · validateCart · validateCheckout (guest → payment)
 *   · overlay/consent guard ("Akzeptieren & Schließen") · JS-error collector.
 *
 * One Playwright test per device profile; each iterates all PDPs with bounded
 * concurrency and writes its results so the aggregator can build the report.
 *
 *   npm run test:pdp-cart
 */
import { test, expect, chromium, webkit, devices, type Browser, type BrowserType } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appConfig } from '../../src/config.js';
import { FUNNEL_ORDER } from '../../src/types.js';
import { type JourneyContext } from '../../src/journeys/common.js';
import { validatePdp } from '../../src/journeys/pdp.js';
import { validateCart } from '../../src/journeys/cart.js';
import { validateCheckout } from '../../src/journeys/checkout.js';
import { installOverlayAutoDismiss } from '../../src/engine/overlayGuard.js';
import { attachJsErrorCollector } from '../../src/validators/jsErrors.js';
import { ensureDir, writeJson, safeFileName } from '../../src/utils/fs.js';
import { createLogger } from '../../src/utils/logger.js';
import { revenueRunDir } from '../../src/revenue/runArtifacts.js';
import type { FormFactor, PdpCartResult } from '../../src/reports/pdpCartReport.js';

const log = createLogger('pdp-cart');

interface DeviceProfile {
  id: string;
  engine: BrowserType;
  engineName: 'chromium' | 'webkit';
  descriptor: Parameters<Browser['newContext']>[0];
  formFactor: FormFactor;
}

/** Requested matrix — engine is what gives true cross-browser coverage. */
const DEVICE_MATRIX: DeviceProfile[] = [
  { id: 'desktop-chrome', engine: chromium, engineName: 'chromium', descriptor: { ...devices['Desktop Chrome'] }, formFactor: 'desktop' },
  { id: 'desktop-safari', engine: webkit, engineName: 'webkit', descriptor: { ...devices['Desktop Safari'] }, formFactor: 'desktop' },
  { id: 'ios-safari-iphone', engine: webkit, engineName: 'webkit', descriptor: { ...devices['iPhone 15'] }, formFactor: 'mobile' },
  { id: 'android-phone', engine: chromium, engineName: 'chromium', descriptor: { ...devices['Pixel 7'] }, formFactor: 'mobile' },
  { id: 'ios-ipad', engine: webkit, engineName: 'webkit', descriptor: { ...devices['iPad (gen 7)'] }, formFactor: 'tablet' },
  { id: 'android-tablet', engine: chromium, engineName: 'chromium', descriptor: { ...devices['Galaxy Tab S4'] }, formFactor: 'tablet' },
];

interface ProductRef { url: string; category?: string }

/** Load the PDP URLs discovered by the discovery suite (or PDP_LIST override). */
function loadProducts(): ProductRef[] {
  const envList = process.env.PDP_LIST?.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  if (envList?.length) return envList.map((url) => ({ url }));

  const path = process.env.PDP_DISCOVERY_JSON ?? join(appConfig.reportsDir, 'pdp-discovery.json');
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as { categories?: Record<string, string[]> };
    const out: ProductRef[] = [];
    const seen = new Set<string>();
    for (const [category, urls] of Object.entries(data.categories ?? {})) {
      for (const url of urls) if (!seen.has(url)) { seen.add(url); out.push({ url, category }); }
    }
    return out;
  } catch { return []; }
}

const ALL_PRODUCTS = loadProducts();
const MAX = Number(process.env.PDP_CART_MAX ?? 0); // 0 = all discovered PDPs
const PRODUCTS = MAX > 0 ? ALL_PRODUCTS.slice(0, MAX) : ALL_PRODUCTS;

/** Optional device filter, e.g. PDP_CART_DEVICES="desktop-chrome,ios-safari-iphone". */
const deviceFilter = process.env.PDP_CART_DEVICES?.split(',').map((s) => s.trim()).filter(Boolean);
const MATRIX = deviceFilter?.length ? DEVICE_MATRIX.filter((d) => deviceFilter.includes(d.id)) : DEVICE_MATRIX;

async function mapLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length || 1) }, async () => {
    while (index < items.length) await worker(items[index++]);
  }));
}

/** Run add-to-cart → cart → checkout → payment for one PDP on a ready page. */
async function runCartJourney(profile: DeviceProfile, product: ProductRef, browser: Browser): Promise<PdpCartResult> {
  const t0 = Date.now();
  const page = await browser.newPage();
  installOverlayAutoDismiss(page);
  const ctx: JourneyContext = { page, device: profile.id, browser: profile.engineName, steps: [], issues: [], reached: 'product-view' };
  const collector = attachJsErrorCollector(page, () => ctx.reached);
  try {
    const added = await validatePdp(ctx, product.url);     // navigate + add to cart (boundary uses existing selectors)
    if (added) {
      const checkoutReachable = await validateCart(ctx);
      if (checkoutReachable) await validateCheckout(ctx);   // guest → address → payment page (no order placed)
    }
  } catch (err) {
    ctx.issues.push({ area: 'journey', severity: 'high', pageUrl: product.url, summary: `Journey crashed: ${err instanceof Error ? err.message : String(err)}` });
  } finally {
    collector.stop();
    await page.close().catch(() => undefined);
  }

  const idx = (stage: typeof FUNNEL_ORDER[number]) => FUNNEL_ORDER.indexOf(stage);
  const reachedIdx = idx(ctx.reached);
  const failingStep = ctx.steps.find((s) => !s.ok);

  return {
    url: product.url,
    category: product.category,
    productName: slug(product.url),
    device: profile.id,
    browser: profile.engineName,
    formFactor: profile.formFactor,
    reachedStage: ctx.reached,
    addedToCart: ctx.steps.some((s) => s.name === 'Add to Cart' && s.ok),
    reachedCart: reachedIdx >= idx('cart'),
    reachedCheckout: reachedIdx >= idx('checkout'),
    reachedPayment: reachedIdx >= idx('payment'),
    failedStep: failingStep?.name,
    error: failingStep?.detail,
    durationMs: Date.now() - t0,
    screenshot: failingStep?.screenshot?.replace(/^reports\//, ''),
  };
}

function slug(url: string): string {
  try { return new URL(url).pathname.split('/').filter(Boolean).pop() ?? url; } catch { return url; }
}

test.describe('@pdp-cart add-to-cart → payment across browsers & devices', () => {
  for (const profile of MATRIX) {
    test(`${profile.id} (${profile.engineName}/${profile.formFactor}) — cart→payment for all PDPs`, async () => {
      test.skip(PRODUCTS.length === 0, 'No PDP URLs found — run "npm run test:pdp-discovery" first (or set PDP_LIST).');
      // Budget scales with the number of PDPs on this device.
      test.setTimeout(Number(process.env.PDP_CART_TIMEOUT_MS ?? Math.max(10, PRODUCTS.length * 1.2) * 60 * 1000));

      const browser = await profile.engine.launch({ headless: process.env.HEADED !== '1' });
      const results: PdpCartResult[] = [];
      let done = 0;
      try {
        await mapLimit(PRODUCTS, Number(process.env.PDP_CART_CONCURRENCY ?? 3), async (product) => {
          const result = await runCartJourney(profile, product, browser).catch((err): PdpCartResult => ({
            url: product.url, category: product.category, productName: slug(product.url),
            device: profile.id, browser: profile.engineName, formFactor: profile.formFactor,
            reachedStage: 'product-view', addedToCart: false, reachedCart: false, reachedCheckout: false,
            reachedPayment: false, failedStep: 'journey error', error: err instanceof Error ? err.message : String(err), durationMs: 0,
          }));
          results.push(result);
          done += 1;
          if (done % 10 === 0 || done === PRODUCTS.length) {
            const fails = results.filter((r) => !r.addedToCart).length;
            log.info(`[${profile.id}] ${done}/${PRODUCTS.length} · add-to-cart failed: ${fails}`);
          }
        });
      } finally {
        await browser.close().catch(() => undefined);
      }

      // Persist this device's results for the aggregator.
      const dir = join(revenueRunDir(), 'pdp-cart');
      await ensureDir(dir);
      await writeJson(join(dir, `${safeFileName(profile.id)}.json`), results);

      const atcFailed = results.filter((r) => !r.addedToCart).length;
      const paid = results.filter((r) => r.reachedPayment).length;
      log.info(`[${profile.id}] DONE — tested ${results.length}, add-to-cart failed ${atcFailed}, reached payment ${paid}.`);

      // Report-driven (the unit of record is the report) — assert only that the
      // device actually exercised the products, so the run stays green and the
      // aggregated report carries the per-PDP/-device findings.
      expect(results.length, 'No PDPs exercised on this device').toBeGreaterThan(0);
    });
  }
});
