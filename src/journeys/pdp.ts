/** pdp.ts — Phase 2: Product Detail Page validation (images, price, add-to-cart, reviews, variants, inventory). */
import { firstVisible, gotoSafe, SELECTORS, step, type JourneyContext } from './common.js';
import { issue } from '../validators/common.js';
import { dismissOverlays } from '../engine/overlayGuard.js';

/** Validates a PDP and attempts add-to-cart. Returns true if add-to-cart succeeded. */
export async function validatePdp(ctx: JourneyContext, pdpUrl: string): Promise<boolean> {
  if (!(await gotoSafe(ctx, pdpUrl, 'product-view'))) return false;
  const { page } = ctx;

  await step(ctx, { name: 'Product image present', stage: 'product-view', severityOnFail: 'high',
    fix: 'Restore product imagery — primary purchase-decision asset.' }, async () => {
    const img = await firstVisible(page, ['main img', '[class*="gallery" i] img', 'picture img', '[data-product] img'], 3000);
    return img !== null;
  });

  await step(ctx, { name: 'Price visible', stage: 'product-view', severityOnFail: 'critical',
    fix: 'Restore price rendering on PDP — no price blocks purchase intent.' }, async () => {
    const price = await firstVisible(page, SELECTORS.price, 2500);
    return price !== null;
  });

  // Variants & reviews & inventory are diagnostic.
  const variant = await firstVisible(page, ['select[name*="variant" i]', '[class*="variant" i]', '[class*="swatch" i]', 'select[name*="size" i]'], 1200);
  if (variant) {
    await variant.click({ timeout: 1500 }).catch(() => undefined); // exercise selection if interactive
  }
  const reviews = await firstVisible(page, ['[class*="review" i]', '[class*="rating" i]', '[itemprop="aggregateRating"]'], 1000);
  if (!reviews) {
    ctx.issues.push({ ...issue('journey', 'low', page.url(),
      'No reviews/rating element detected on PDP.', 'Confirm social-proof widget renders (conversion lever).'),
      funnelStage: 'product-view', device: ctx.device });
  }

  // The revenue-critical action.
  const added = await step(ctx, { name: 'Add to Cart', stage: 'add-to-cart', severityOnFail: 'critical',
    fix: 'Add-to-Cart is broken — this directly blocks all revenue from this device.' }, async () => {
    const atc = await firstVisible(page, SELECTORS.addToCart, 4000);
    if (!atc) return false;
    if (await atc.isDisabled().catch(() => false)) return false; // likely out-of-stock / inventory issue
    await dismissOverlays(page);
    await atc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);
    await atc.click({ timeout: 8000 });
    // Confirm cart reflected the add (mini-cart / count / drawer).
    const confirmation = await firstVisible(page, [
      '[class*="mini-cart" i]', '[class*="cart-count" i]', '[class*="added" i]',
      '[class*="drawer" i]', 'a[href*="warenkorb"]', 'a[href*="cart"]',
    ], 6000);
    return confirmation !== null;
  });

  return added;
}
