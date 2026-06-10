import { join } from 'node:path';
import { expect, test } from '../../src/fixtures/index.js';
import { appConfig } from '../../src/config.js';
import { traversePage } from '../../src/engine/scrollEngine.js';
import { safeFileName, writeJson } from '../../src/utils/fs.js';

/**
 * @explore — MANDATORY full-page exploration for every discovered page.
 * Drives each page through the complete TOP → BOTTOM → TOP scroll cycle
 * (lazy-load dwell, dynamic content, 3 screenshots) before the other suites
 * run their targeted checks. Findings flow into the dashboard; per-page
 * scroll metrics are written to reports/traversals/ for report:suites.
 *
 * Runs on chromium only (browser-agnostic value) and gets a long timeout
 * because it visits many pages in one test.
 */
test.describe('page exploration @explore', () => {
  test('scroll every discovered page top → bottom → top', async ({ page, dismissOverlays, sitePages, issueSink }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Exploration runs on chromium only');
    test.setTimeout(Number(process.env.EXPLORE_TIMEOUT_MS ?? 20 * 60 * 1000));
    expect(sitePages.length, 'pages discovered to explore').toBeGreaterThan(0);

    for (const [index, discovered] of sitePages.entries()) {
      console.log(`[explore ${index + 1}/${sitePages.length}] ${discovered.url}`);
      const navigated = await page.goto(discovered.url, { waitUntil: 'domcontentloaded', timeout: appConfig.requestTimeoutMs })
        .then(() => true).catch(() => false);
      if (!navigated) continue;
      await dismissOverlays();

      const dir = join(appConfig.reportsDir, 'evidence', 'exploration', safeFileName(discovered.url));
      const { metrics, issues } = await traversePage(page, discovered.url, dir);
      issueSink.push(...issues);
      await writeJson(join(appConfig.reportsDir, 'traversals', `${safeFileName(discovered.url)}.json`), metrics);
      console.log(`  ↕ ${metrics.scrollDepthPercent}% depth · ${metrics.lazyAssetsFound} lazy assets · ${metrics.failedRenders} failed renders · ${metrics.scrollCompleted ? 'completed' : 'incomplete'}`);
    }
  });
});
