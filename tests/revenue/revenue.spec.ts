/**
 * revenue.spec.ts — @revenue suite (Phase 2 + 5).
 *
 * Drives the full purchase journey across whatever Playwright projects are
 * active (desktop + mobile device matrix). Persists each JourneyResult to
 * reports/journeys/ so the conversion/revenue/dashboard layers (run via
 * `npm run revenue:report`) can aggregate them. Assertions are intentionally
 * lenient on the run itself — the unit of record is the issue, not a thrown
 * assertion — but a fully-blocked journey (never reaching product-view) fails
 * the test so CI surfaces a P0.
 */
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { runPurchaseJourney } from '../../src/journeys/runJourneys.js';
import { installOverlayAutoDismiss } from '../../src/engine/overlayGuard.js';
import { ensureDir, writeJson, safeFileName } from '../../src/utils/fs.js';
import { revenueRunDir } from '../../src/revenue/runArtifacts.js';

test.describe('@revenue purchase journey', () => {
  test('customer can browse → add to cart → reach payment', async ({ page, browserName }, testInfo) => {
    test.setTimeout(180_000);
    installOverlayAutoDismiss(page);

    const device = testInfo.project.name;
    const result = await runPurchaseJourney(page, device, browserName);

    const dir = join(revenueRunDir(), 'journeys');
    await ensureDir(dir);
    await writeJson(join(dir, `${safeFileName(`${device}-${browserName}`)}.json`), result);

    // Attach a compact summary for the Playwright HTML report.
    await testInfo.attach('journey-summary', {
      body: JSON.stringify({
        reachedStage: result.reachedStage,
        completed: result.completed,
        steps: result.steps.map((s) => ({ name: s.name, ok: s.ok })),
        issues: result.issues.length,
        jsErrors: result.jsErrors.length,
      }, null, 2),
      contentType: 'application/json',
    });

    // Hard gate: a journey that never reaches product-view is a P0 outage.
    const reachedProduct = result.steps.some((s) => s.stage === 'product-view' && s.ok);
    expect(reachedProduct, `Journey on ${device} did not reach product-view (P0 revenue block).`).toBeTruthy();
  });
});
