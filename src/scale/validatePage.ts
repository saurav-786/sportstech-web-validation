import type { BrowserContext, Response } from '@playwright/test';
import { join } from 'node:path';
import { applyConfidence } from '../ai/confidence.js';
import { appConfig } from '../config.js';
import { dismissOverlays, installOverlayAutoDismiss } from '../engine/overlayGuard.js';
import { traversePage } from '../engine/scrollEngine.js';
import type { ValidationIssue } from '../types.js';
import { safeFileName, writeJson } from '../utils/fs.js';
import { collectConsoleIssues } from '../validators/common.js';
import { validateAccessibility } from '../validators/accessibility.js';
import { validateForms } from '../validators/forms.js';
import { validateImages } from '../validators/images.js';
import { validateLinks, validatePopups } from '../validators/interactions.js';
import { validateSecurity } from '../validators/security.js';
import { validateSeo } from '../validators/seo.js';
import { validateUi } from '../validators/ui.js';

/**
 * Single-page validation unit used by distributed workers. Reuses the same
 * validators as the in-process scan and writes findings to reports/issues/
 * so `npm run report:suites` can aggregate results from every worker node.
 */
export async function validatePage(context: BrowserContext, pageUrl: string): Promise<ValidationIssue[]> {
  const page = await context.newPage();
  installOverlayAutoDismiss(page);
  const request = context.request;
  const issues: ValidationIssue[] = [];
  let response: Response | null = null;

  try {
    const consoleIssues = await collectConsoleIssues(page, pageUrl, async () => {
      response = await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: appConfig.requestTimeoutMs });
      await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined);
    });
    await dismissOverlays(page).catch(() => undefined);

    if (process.env.SCROLL_ENGINE !== '0') {
      const dir = join(appConfig.reportsDir, 'evidence', 'queue', safeFileName(pageUrl));
      issues.push(...(await traversePage(page, pageUrl, dir)).issues);
    }

    issues.push(
      ...consoleIssues,
      ...await validateUi(page, pageUrl, response, appConfig.devices[0]),
      ...await validateImages(page, pageUrl),
      ...await validateForms(page, pageUrl),
      ...await validateLinks(request, page, pageUrl),
      ...await validatePopups(page, pageUrl),
      ...await validateSeo(page, pageUrl),
      ...await validateSecurity(request, pageUrl, response),
      ...(appConfig.quickScan ? [] : await validateAccessibility(page, pageUrl).catch(() => []))
    );

    const vetted = await applyConfidence(page, request, issues);
    await writeJson(join(appConfig.reportsDir, 'issues', `queue-${safeFileName(pageUrl)}.json`), vetted);
    return vetted;
  } finally {
    await page.close().catch(() => undefined);
  }
}
