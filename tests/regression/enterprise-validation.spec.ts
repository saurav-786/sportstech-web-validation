import { expect, test, type Response } from '@playwright/test';
import { join } from 'node:path';
import { appConfig } from '../../src/config.js';
import { crawlWebsite } from '../../src/discovery/crawler.js';
import { enrichIssuesWithAi } from '../../src/ai/rootCause.js';
import { writeSiteReports } from '../../src/reports/siteReport.js';
import type { PageValidationResult, ScrollMetrics, ValidationIssue, WebsiteMap } from '../../src/types.js';
import { ensureDir, safeFileName } from '../../src/utils/fs.js';
import { collectConsoleIssues } from '../../src/validators/common.js';
import { validateAccessibility } from '../../src/validators/accessibility.js';
import { validateAnalytics } from '../../src/validators/analytics.js';
import { validateForms } from '../../src/validators/forms.js';
import { validateImages } from '../../src/validators/images.js';
import { validateClickableControls, validateLinks, validateMediaAndCarousels, validatePopups } from '../../src/validators/interactions.js';
import { validateResponsive } from '../../src/validators/responsive.js';
import { validateSecurity } from '../../src/validators/security.js';
import { validateSeo } from '../../src/validators/seo.js';
import { validateUi } from '../../src/validators/ui.js';
import { runDemoFlow } from '../../src/validators/demoFlow.js';
import { traversePage } from '../../src/engine/scrollEngine.js';
import { dismissOverlays, installOverlayAutoDismiss } from '../../src/engine/overlayGuard.js';
import { applyConfidence } from '../../src/ai/confidence.js';

let websiteMap: WebsiteMap;
const allResults: PageValidationResult[] = [];
const allTraversals: ScrollMetrics[] = [];
const scanTimeoutMs = Number(process.env.SCAN_TIMEOUT_MS ?? 300_000);

test.setTimeout(scanTimeoutMs);

test.beforeAll(async () => {
  test.setTimeout(scanTimeoutMs);
  console.log(`Discovering up to ${appConfig.maxPages} page(s) from ${appConfig.baseUrl}`);
  websiteMap = await crawlWebsite();
  console.log(`Discovered ${websiteMap.totalPages} page(s).`);
});

test.afterAll(async () => {
  test.setTimeout(scanTimeoutMs);
  if (allResults.length === 0) {
    await writeSiteReports([], [{
      area: 'ui',
      severity: 'critical',
      pageUrl: appConfig.baseUrl,
      summary: 'Scan completed without page validation results.',
      suggestedFix: 'Check discovery and navigation timeouts, then rerun the scan.'
    }]);
    return;
  }

  const enrichedResults = [];
  for (const result of allResults) {
    enrichedResults.push({ ...result, issues: await enrichIssuesWithAi(result.issues) });
  }
  await writeSiteReports(enrichedResults, [], undefined, allTraversals);
});

test('crawl and validate discovered website surface', async ({ page, browser, request, browserName }, testInfo) => {
  expect(websiteMap.totalPages).toBeGreaterThan(0);
  installOverlayAutoDismiss(page); // auto-clear cookie banners/popups on every navigation

  for (const [index, discovered] of websiteMap.pages.entries()) {
    const pageUrl = discovered.url;
    console.log(`[${index + 1}/${websiteMap.pages.length}] Validating ${pageUrl}`);
    const pageDir = join(appConfig.reportsDir, 'evidence', browserName, safeFileName(pageUrl));
    const responsiveDir = join(pageDir, 'responsive');
    await ensureDir(responsiveDir);

    const screenshotPath = join(pageDir, 'full-page.png');
    const issues: ValidationIssue[] = [];
    let response: Response | null = null;

    try {
      const navigation: { response: Response | null } = { response: null };
      const consoleIssues = await collectConsoleIssues(page, pageUrl, async () => {
        navigation.response = await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: appConfig.requestTimeoutMs });
        await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined);
      });
      response = navigation.response;
      await dismissOverlays(page).catch(() => undefined); // ensure banner gone before validating

      if (appConfig.demoMode) {
        console.log(`Demo flow: scrolling page and exercising unique tabs for ${pageUrl}`);
      }
      // MANDATORY full-page exploration: TOP → BOTTOM → TOP before any page-specific tests.
      if (process.env.SCROLL_ENGINE !== '0') {
        const traversal = await traversePage(page, pageUrl, pageDir);
        issues.push(...traversal.issues);
        allTraversals.push(traversal.metrics);
        console.log(`  ↕ explored: ${traversal.metrics.scrollDepthPercent}% depth, ${traversal.metrics.lazyAssetsFound} lazy assets, ${traversal.metrics.failedRenders} failed renders`);
      }

      issues.push(
        ...consoleIssues,
        ...await runDemoFlow(page, pageUrl),
        ...await validateUi(page, pageUrl, response, appConfig.devices[0]),
        ...await validateImages(page, pageUrl),
        ...await validateForms(page, pageUrl),
        ...await validateLinks(request, page, pageUrl),
        ...await validateClickableControls(page, pageUrl),
        ...await validateMediaAndCarousels(page, pageUrl),
        ...await validatePopups(page, pageUrl),
        ...await validateSeo(page, pageUrl),
        ...await validateSecurity(request, pageUrl, response),
        ...await validateAnalytics(page, pageUrl),
        ...(appConfig.quickScan ? [] : await validateAccessibility(page, pageUrl))
      );

      if (browserName === 'chromium' && !appConfig.quickScan) {
        issues.push(...await validateResponsive(browser, pageUrl, appConfig.devices, responsiveDir));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({
        area: 'ui',
        severity: 'critical',
        pageUrl,
        summary: 'Page validation crashed before all checks completed.',
        suggestedFix: 'Inspect the attached trace and increase timeout limits if the target page is slow.',
        evidence: message
      });
    }

    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
    if (response || issues.length > 0) {
      await testInfo.attach(`full-page-${safeFileName(pageUrl)}`, { path: screenshotPath, contentType: 'image/png' }).catch(() => undefined);
    }

    // False-positive reduction: re-validate critical/high findings, attach confidence scores
    const vettedIssues = await applyConfidence(page, request, issues);
    issues.length = 0;
    issues.push(...vettedIssues);

    const pageResult: PageValidationResult = {
      url: pageUrl,
      browserName,
      status: response?.status(),
      passed: !issues.some((issue) => ['critical', 'high'].includes(issue.severity)),
      screenshot: screenshotPath,
      metrics: await page.evaluate(() => {
        const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
        return {
          domContentLoadedMs: navigation ? Math.round(navigation.domContentLoadedEventEnd) : 0,
          loadMs: navigation ? Math.round(navigation.loadEventEnd) : 0
        };
      }).catch(() => ({ domContentLoadedMs: 0, loadMs: 0 })),
      issues
    };
    allResults.push(pageResult);
  }
});
