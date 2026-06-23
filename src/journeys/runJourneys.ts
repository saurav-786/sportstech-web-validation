/**
 * runJourneys.ts — Phase 2 orchestrator.
 *
 * Runs the full revenue journey (homepage → PLP → PDP → cart → checkout/payment
 * boundary) on a single Playwright page, with JS-error capture (Phase 4) active
 * throughout, and returns a structured JourneyResult plus issues. Stateful: each
 * stage only runs if the previous one advanced far enough, so the `reachedStage`
 * marker is an honest record of how far a real customer would get.
 */
import type { Page } from '@playwright/test';
import type { JourneyResult, FunnelStage } from '../types.js';
import { type JourneyContext } from './common.js';
import { attachJsErrorCollector, jsErrorsToIssues } from '../validators/jsErrors.js';
import { validateHomepage } from './homepage.js';
import { validatePlp } from './plp.js';
import { validatePdp } from './pdp.js';
import { validateCart } from './cart.js';
import { validateCheckout } from './checkout.js';
import { validateBundleCrossSell } from './bundleCrossSell.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('journeys');

export async function runPurchaseJourney(page: Page, device: string, browser: string): Promise<JourneyResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const ctx: JourneyContext = { page, device, browser, steps: [], issues: [], reached: 'discovery' };

  const collector = attachJsErrorCollector(page, () => ctx.reached as FunnelStage);

  try {
    await validateHomepage(ctx);

    let pdpUrl: string | null = null;
    if (reached(ctx, 'discovery')) pdpUrl = await validatePlp(ctx);

    let added = false;
    if (pdpUrl) {
      added = await validatePdp(ctx, pdpUrl);
      // Bundle/cross-sell/AOV checks on the PDP (incident: AOV drop on 11.06.2026).
      await validateBundleCrossSell(ctx, 'pdp').catch(() => undefined);
    }

    let checkoutReachable = false;
    if (added) {
      checkoutReachable = await validateCart(ctx);
      await validateBundleCrossSell(ctx, 'cart').catch(() => undefined);
    }

    if (checkoutReachable) await validateCheckout(ctx);
  } catch (err) {
    log.warn(`Journey aborted on ${device}/${browser}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const jsErrors = collector.stop();
  ctx.issues.push(...jsErrorsToIssues(jsErrors));

  return {
    name: 'purchase',
    device,
    browser,
    startedAt,
    reachedStage: ctx.reached,
    completed: ctx.reached === 'payment' || ctx.reached === 'order-complete',
    steps: ctx.steps,
    issues: ctx.issues,
    jsErrors,
    durationMs: Date.now() - t0,
  };
}

function reached(ctx: JourneyContext, _stage: FunnelStage): boolean {
  // Homepage must have at least loaded (discovery) to attempt the listing.
  return ctx.steps.some((s) => s.stage === 'discovery' && s.ok);
}
