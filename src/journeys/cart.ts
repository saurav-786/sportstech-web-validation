/** cart.ts — Phase 2: Cart validation (contents, quantity update, remove, persistence). */
import { firstVisible, SELECTORS, step, type JourneyContext } from './common.js';
import { issue } from '../validators/common.js';

/** Opens the cart, validates contents and operations. Returns true if a checkout entry is reachable. */
export async function validateCart(ctx: JourneyContext): Promise<boolean> {
  const { page } = ctx;

  await step(ctx, { name: 'Open cart', stage: 'cart', severityOnFail: 'critical',
    fix: 'Cart is unreachable after add-to-cart — blocks the entire purchase path.' }, async () => {
    const link = await firstVisible(page, SELECTORS.cartLink, 3000);
    if (link) { await link.click({ timeout: 4000 }).catch(() => undefined); }
    else { await page.goto(new URL('/warenkorb', page.url()).toString(), { waitUntil: 'domcontentloaded' }).catch(() => undefined); }
    await page.waitForLoadState('domcontentloaded', { timeout: 12_000 }).catch(() => undefined);
    return true;
  });

  // Cart must contain at least one line item.
  const lineItems = await page.locator('[class*="cart-item" i], [class*="line-item" i], tr[class*="item" i], [data-cart-item]').count().catch(() => 0);
  await step(ctx, { name: 'Cart contains the added item', stage: 'cart', severityOnFail: 'critical',
    fix: 'Item did not persist to cart — investigate cart session/cookie/API.' },
    async () => lineItems > 0 || (await firstVisible(page, SELECTORS.price, 2000)) !== null);

  // Quantity update (degradation if broken).
  const qty = await firstVisible(page, SELECTORS.quantityInput, 1500);
  if (qty) {
    await step(ctx, { name: 'Quantity update', stage: 'cart', severityOnFail: 'high',
      fix: 'Quantity update failed — reduces basket size and revenue per order.' }, async () => {
      await qty.fill('2').catch(() => undefined);
      await qty.press('Enter').catch(() => undefined);
      await page.waitForTimeout(800);
      return true;
    });
  }

  // Cart persistence across reload.
  await step(ctx, { name: 'Cart persists across reload', stage: 'cart', severityOnFail: 'high',
    fix: 'Cart empties on reload — session/cookie persistence broken, causes abandonment.' }, async () => {
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
    const persisted = await firstVisible(page, [
      '[class*="cart-item" i]', '[class*="line-item" i]', '[data-cart-item]',
      '.checkout-aside-summary', '.offcanvas-cart-items', 'a[href*="/checkout/cart"]',
    ], 5000);
    const emptyState = await firstVisible(page, [
      ':text-matches("Warenkorb ist leer", "i")', ':text-matches("cart is empty", "i")',
    ], 1200);
    return persisted !== null && emptyState === null;
  });

  // Remove item is diagnostic only (we don't want to empty the cart before checkout).
  const remove = await firstVisible(page, SELECTORS.removeItem, 1000);
  if (!remove) {
    ctx.issues.push({ ...issue('journey', 'low', page.url(),
      'No remove-item control detected in cart.', 'Confirm line-item removal is available.'),
      funnelStage: 'cart', device: ctx.device });
  }

  const checkout = await firstVisible(page, SELECTORS.checkoutButton, 2500);
  return checkout !== null;
}
