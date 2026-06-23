/**
 * common.ts — shared toolkit for stateful ecommerce journeys.
 *
 * Design: journeys are resilient. A missing selector emits a ValidationIssue
 * (and stops the journey at that stage) rather than throwing — so a broken
 * "Add to Cart" is reported as a P0 revenue issue, not a test crash. Selectors
 * are candidate-lists (multilingual: DE + EN) because the target site is German.
 */

import type { Locator, Page } from '@playwright/test';
import { join } from 'node:path';
import type { FunnelStage, JourneyStep, ValidationIssue } from '../types.js';
import { issue } from '../validators/common.js';
import { ensureDir, safeFileName } from '../utils/fs.js';
import { revenueRunDir } from '../revenue/runArtifacts.js';

export interface JourneyContext {
  page: Page;
  device: string;
  browser: string;
  steps: JourneyStep[];
  issues: ValidationIssue[];
  reached: FunnelStage;
}

/** Find the first visible locator matching any candidate selector. */
export async function firstVisible(page: Page, candidates: string[], timeoutMs = 4000): Promise<Locator | null> {
  const locators = candidates.map((selector) => page.locator(selector).first());
  const winner = await Promise.any(locators.map(async (locator) => {
    await locator.waitFor({ state: 'visible', timeout: timeoutMs });
    return locator;
  })).catch(() => null);
  if (winner && await winner.isVisible().catch(() => false)) {
    return winner;
  }
  return null;
}

/** Record a step outcome and advance the reached-stage marker on success. */
export function recordStep(
  ctx: JourneyContext,
  name: string,
  stage: FunnelStage,
  ok: boolean,
  startedAt: number,
  detail?: string,
): JourneyStep {
  const step: JourneyStep = { name, stage, ok, durationMs: Date.now() - startedAt, detail, pageUrl: ctx.page.url() };
  ctx.steps.push(step);
  if (ok) ctx.reached = stage;
  return step;
}

/**
 * Run one journey action. On failure, pushes a revenue-classified issue tagged
 * with the funnel stage. Returns whether the step succeeded.
 */
export async function step(
  ctx: JourneyContext,
  opts: { name: string; stage: FunnelStage; severityOnFail: ValidationIssue['severity']; fix: string },
  action: () => Promise<boolean>,
): Promise<boolean> {
  const startedAt = Date.now();
  let ok = false;
  let detail: string | undefined;
  try {
    ok = await action();
  } catch (err) {
    ok = false;
    detail = err instanceof Error ? err.message : String(err);
  }
  recordStep(ctx, opts.name, opts.stage, ok, startedAt, detail);
  if (!ok) {
    const evidenceDir = join(revenueRunDir(), 'evidence', 'journeys', safeFileName(`${ctx.device}-${ctx.browser}`));
    await ensureDir(evidenceDir);
    const screenshot = join(evidenceDir, `${safeFileName(`${opts.stage}-${opts.name}`)}.png`);
    await ctx.page.screenshot({ path: screenshot, fullPage: false }).catch(() => undefined);
    ctx.steps[ctx.steps.length - 1].screenshot = screenshot;
    ctx.issues.push({
      ...issue('journey', opts.severityOnFail, ctx.page.url(),
        `${opts.name} failed on ${ctx.device}/${ctx.browser}.`, opts.fix, detail),
      funnelStage: opts.stage,
      device: ctx.device,
      failureClass: 'frontend',
      failureCategory: 'Revenue Risk Issue',
      codeFixNeeded: false,
      websiteFixNeeded: true,
      confidence: detail ? 88 : 78,
    });
  }
  return ok;
}

/** Safe navigation that records an issue on load failure. */
export async function gotoSafe(ctx: JourneyContext, url: string, stage: FunnelStage): Promise<boolean> {
  return step(ctx, {
    name: `Load ${url}`,
    stage,
    severityOnFail: 'critical',
    fix: 'Fix server response, routing, or timeout for this revenue-critical page.',
  }, async () => {
    let res = await ctx.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null);
    if (!res) {
      res = await ctx.page.goto(url, { waitUntil: 'commit', timeout: 25_000 }).catch(() => null);
      await ctx.page.locator('body').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
    }
    if (!res) return false;
    if (res.status() >= 400) return false;
    await ctx.page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
    return true;
  });
}

export const SELECTORS = {
  search: [
    'input[type="search"]', 'input[name*="search" i]', 'input[name="q"]',
    'input[placeholder*="such" i]', 'input[placeholder*="search" i]', '[role="searchbox"]',
  ],
  productLink: [
    // sportstech (Shopware) real markup, then generic fallbacks.
    '.product_link_action_button', 'a .product_link_action_button', '.product-info a',
    '.product-box a.product-name', '.card-body .product-name',
    'a[href*="/p/"]', 'a[href*="produkt"]', 'a[href*="product"]',
    '.product a', '[data-product] a', 'article a[href]',
  ],
  addToCart: [
    'button:has-text("In den Warenkorb")', '.btn-buy', 'button.btn-buy',
    'button:has-text("Add to cart")', 'button:has-text("Add to Cart")',
    '[name*="add-to-cart" i]', '[data-add-to-cart]',
    'button[id*="cart" i]', 'form[action*="cart"] button[type="submit"]',
  ],
  cartLink: [
    'a[href*="/checkout/cart"]', 'a[title*="Warenkorb" i]', '.header-cart',
    'a[href*="warenkorb"]', 'a[href*="cart"]', 'a[aria-label*="warenkorb" i]',
    'a[aria-label*="cart" i]', '[data-cart-link]',
  ],
  checkoutButton: [
    'a:has-text("Zur Kasse")', 'button:has-text("Zur Kasse")',
    'a[href*="/checkout/confirm"]', 'a[href*="/checkout"]',
    'a:has-text("Checkout")', 'button:has-text("Checkout")',
    'a[href*="checkout"]', 'a[href*="kasse"]', '[data-checkout]',
  ],
  quantityInput: ['input[name*="qty" i]', 'input[name*="quantity" i]', 'input[type="number"][min]'],
  removeItem: [
    'button[aria-label*="entfernen" i]', 'button[aria-label*="remove" i]',
    'a:has-text("Entfernen")', 'a:has-text("Remove")', '[data-remove-item]',
  ],
  price: ['[class*="price" i]', '[data-price]', '[itemprop="price"]'],
};
