import { test as base, type Page } from '@playwright/test';
import { join } from 'node:path';
import { appConfig } from '../config.js';
import { getPagesForSuite } from '../discovery/pageList.js';
import { dismissOverlays as dismissOverlaysImpl, installOverlayAutoDismiss } from '../engine/overlayGuard.js';
import type { DiscoveredPage, ValidationIssue } from '../types.js';
import { writeJson } from '../utils/fs.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('fixtures');

interface ValidationFixtures {
  /** Discovered site pages, prioritized by business value. */
  sitePages: DiscoveredPage[];
  /** Collects issues; flushed to reports/issues/<suite>-<browser>.json after each test. */
  issueSink: ValidationIssue[];
  /** Dismisses cookie banners / popups after navigation (manual trigger; also runs automatically). */
  dismissOverlays: () => Promise<void>;
}

export const test = base.extend<ValidationFixtures>({
  // Auto-install the overlay guard on every test page so cookie banners / popups are
  // cleared automatically whenever a page loads — no per-test wiring required.
  page: async ({ page }, use) => {
    installOverlayAutoDismiss(page);
    await use(page);
  },

  // Worker-scoped would be ideal, but page list is cached on disk so test scope is cheap.
  sitePages: async ({}, use) => {
    const suiteLimit = Number(process.env.SUITE_MAX_PAGES ?? Math.min(appConfig.maxPages, 15));
    await use(await getPagesForSuite(suiteLimit));
  },

  issueSink: async ({ browserName }, use, testInfo) => {
    const issues: ValidationIssue[] = [];
    await use(issues);
    if (issues.length > 0) {
      const suite = testInfo.titlePath[0]?.replace(/[^a-z0-9]+/gi, '-') ?? 'suite';
      const file = join(appConfig.reportsDir, 'issues', `${suite}-${browserName}-${testInfo.workerIndex}.json`);
      await writeJson(file, issues);
      log.info(`Wrote ${issues.length} issue(s) to ${file}`);
    }
  },

  dismissOverlays: async ({ page }, use) => {
    await use(async () => { await dismissOverlaysImpl(page as Page); });
  }
});

export { expect } from '@playwright/test';
