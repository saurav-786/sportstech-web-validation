import { expect, test } from '../../src/fixtures/index.js';
import { appConfig } from '../../src/config.js';
import { collectWebVitals, installVitalsObservers, vitalsToIssues } from '../../src/performance/webVitals.js';
import { writeJson } from '../../src/utils/fs.js';

/**
 * @performance — Core Web Vitals (FCP, LCP, CLS, TBT), load timings, page weight,
 * slow requests, render-blocking resources, measured against configurable budgets.
 * Full vitals require Chromium; other browsers report navigation timings only.
 */
test.describe('performance validation @performance', () => {
  test('core web vitals stay within budgets', async ({ page, dismissOverlays, sitePages, issueSink }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'CWV observers are Chromium-only');
    const vitalsByPage: Record<string, unknown> = {};

    for (const discovered of sitePages.slice(0, Number(process.env.PERF_MAX_PAGES ?? 8))) {
      await installVitalsObservers(page);
      await page.goto(discovered.url, { waitUntil: 'load', timeout: appConfig.requestTimeoutMs }).catch(() => null);
      await dismissOverlays();
      await page.waitForTimeout(2_000); // settle LCP/CLS
      const vitals = await collectWebVitals(page).catch(() => null);
      if (!vitals) continue;
      vitalsByPage[discovered.url] = vitals;
      issueSink.push(...vitalsToIssues(vitals, discovered.url));
    }

    await writeJson(`${appConfig.reportsDir}/web-vitals.json`, vitalsByPage);
    const severe = issueSink.filter((issue) => issue.severity === 'high');
    expect(severe, `budget breaches:\n${severe.map((issue) => `${issue.pageUrl}: ${issue.summary}`).join('\n')}`).toHaveLength(0);
  });
});
