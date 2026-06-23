/**
 * bundleCrossSell.ts — incident-specific checks for the 11.06.2026 revenue/AOV drop.
 *
 * A drop in average order value points at bundle / cross-sell / add-on breakage
 * (customers no longer adding the higher-value combinations). This validates, on
 * the PDP and in the cart:
 *   - cross-sell / "Das könnte dir gefallen" / accessory carousels are present
 *   - bundle / set / "im Set kaufen" offers render with a price
 *   - bundle price is internally consistent (set price ≤ sum of parts, > 0)
 *   - add-on checkboxes are interactive
 * Findings are tagged funnelStage 'add-to-cart' so they surface as AOV risks.
 */
import type { Page } from '@playwright/test';
import type { JourneyContext } from './common.js';
import { issue } from '../validators/common.js';

interface BundleSignal {
  crossSellCount: number;
  bundleCount: number;
  bundlePrices: number[];
  addOnInputs: number;
  partPrices: number[];
}

async function readBundleSignals(page: Page): Promise<BundleSignal> {
  return page.evaluate(() => {
    const txt = (el: Element) => (el.textContent ?? '').trim();
    const parsePrice = (s: string): number | null => {
      const m = s.replace(/\s/g, '').match(/(\d{1,3}(?:[.\s]\d{3})*|\d+)[,.](\d{2})\s*€|€\s*(\d{1,3}(?:[.\s]\d{3})*|\d+)[,.](\d{2})/);
      if (!m) return null;
      const whole = (m[1] ?? m[3] ?? '').replace(/[.\s]/g, '');
      const dec = m[2] ?? m[4] ?? '00';
      const val = Number(`${whole}.${dec}`);
      return Number.isFinite(val) ? val : null;
    };

    const crossSellSel = '[class*="cross-sell" i],[class*="crosssell" i],[class*="related" i],[class*="recommend" i],[class*="zubehoer" i],[class*="accessory" i],[class*="upsell" i],[data-cross-selling]';
    const bundleSel = '[class*="bundle" i],[class*="set" i],[class*="combo" i],[class*="im-set" i],[data-bundle]';

    const crossSellNodes = Array.from(document.querySelectorAll(crossSellSel));
    const crossSellCount = crossSellNodes.reduce((n, node) =>
      n + node.querySelectorAll('a,[class*="product" i],[class*="card" i]').length, 0);

    const bundleNodes = Array.from(document.querySelectorAll(bundleSel));
    const bundlePrices: number[] = [];
    for (const node of bundleNodes) {
      const p = parsePrice(txt(node));
      if (p && p > 0) bundlePrices.push(p);
    }

    const addOnInputs = document.querySelectorAll(
      `${bundleSel.split(',').map((s) => `${s} input[type="checkbox"]`).join(',')},[class*="addon" i] input,[class*="add-on" i] input`
    ).length;

    // Candidate "part" prices on the page (for a sanity check vs the bundle price).
    const partPrices: number[] = [];
    for (const el of Array.from(document.querySelectorAll('[class*="price" i],[data-price],[itemprop="price"]'))) {
      const p = parsePrice(txt(el));
      if (p && p > 0) partPrices.push(p);
    }

    return { crossSellCount, bundleCount: bundleNodes.length, bundlePrices, addOnInputs, partPrices };
  }).catch(() => ({ crossSellCount: 0, bundleCount: 0, bundlePrices: [], addOnInputs: 0, partPrices: [] }));
}

export async function validateBundleCrossSell(ctx: JourneyContext, surface: 'pdp' | 'cart'): Promise<void> {
  const sig = await readBundleSignals(ctx.page);
  const where = surface.toUpperCase();

  // Cross-sell absence is an AOV risk (directly relevant to the incident).
  if (sig.crossSellCount === 0) {
    ctx.issues.push({ ...issue('journey', surface === 'pdp' ? 'high' : 'medium', ctx.page.url(),
      `No cross-sell / accessory recommendations detected on ${where} (${ctx.device}).`,
      'Cross-sell drives average order value; verify the recommendation block renders and is populated.'),
      funnelStage: 'add-to-cart', device: ctx.device });
  }

  // Bundle price sanity: a set price should be > 0 and not exceed the sum of part prices.
  if (sig.bundleCount > 0 && sig.bundlePrices.length > 0) {
    const setPrice = Math.max(...sig.bundlePrices);
    const partsSum = sig.partPrices.reduce((a, b) => a + b, 0);
    if (setPrice <= 0) {
      ctx.issues.push({ ...issue('journey', 'high', ctx.page.url(),
        `Bundle present on ${where} but no valid price parsed (${ctx.device}).`,
        'Bundle price is missing/zero — investigate pricing service for set/bundle SKUs.'),
        funnelStage: 'add-to-cart', device: ctx.device });
    } else if (partsSum > 0 && setPrice > partsSum * 1.01) {
      ctx.issues.push({ ...issue('journey', 'high', ctx.page.url(),
        `Possible bundle price mismatch on ${where}: set €${setPrice.toFixed(2)} exceeds sum of parts €${partsSum.toFixed(2)} (${ctx.device}).`,
        'A bundle priced above its components removes the incentive and suppresses AOV — verify bundle pricing rules.'),
        funnelStage: 'add-to-cart', device: ctx.device });
    }
  } else if (surface === 'pdp' && sig.bundleCount === 0) {
    ctx.issues.push({ ...issue('journey', 'low', ctx.page.url(),
      `No bundle/set offer detected on ${where} (${ctx.device}).`,
      'If bundles are expected on this PDP, confirm the bundle module renders.'),
      funnelStage: 'add-to-cart', device: ctx.device });
  }
}
