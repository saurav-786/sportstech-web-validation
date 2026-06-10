import type { Page } from '@playwright/test';
import { appConfig } from '../config.js';
import type { ValidationIssue } from '../types.js';
import { issue } from './common.js';

async function waitBriefly(page: Page, ms = 350): Promise<void> {
  await page.waitForTimeout(ms);
}

export async function scrollToPageBottom(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const viewportStep = Math.max(360, Math.floor(window.innerHeight * 0.75));
    let previousY = -1;

    for (let step = 0; step < 40; step += 1) {
      window.scrollBy(0, viewportStep);
      await delay(180);

      const bottom = Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 4;
      if (bottom || window.scrollY === previousY) break;
      previousY = window.scrollY;
    }
  });
  await waitBriefly(page);
}

export async function exerciseVisibleTabs(page: Page, pageUrl: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const tabs = page.locator([
    '[role="tab"]:visible',
    'button[aria-controls]:visible',
    '[data-bs-toggle="tab"]:visible',
    '[data-toggle="tab"]:visible',
    'a[href^="#"][role="tab"]:visible'
  ].join(', '));
  const seen = new Set<string>();
  const count = Math.min(await tabs.count().catch(() => 0), appConfig.maxTabChecks * 3);
  let exercised = 0;

  for (let index = 0; index < count && exercised < appConfig.maxTabChecks; index += 1) {
    const tab = tabs.nth(index);
    const key = await tab.evaluate((element) => {
      const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ');
      return element.getAttribute('aria-controls')
        || element.getAttribute('href')
        || element.getAttribute('data-bs-target')
        || element.getAttribute('data-target')
        || text;
    }).catch(() => '');

    if (!key || seen.has(key)) continue;
    seen.add(key);

    const selected = await tab.getAttribute('aria-selected').catch(() => null);
    if (selected === 'true') continue;

    await tab.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => undefined);
    await tab.click({ timeout: 3_000 }).catch((error) => {
      issues.push(issue('ui', 'medium', pageUrl, `Could not switch tab: ${key}`, 'Ensure tab controls are visible, enabled, and not covered by sticky overlays.', error.message));
    });

    await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => undefined);
    await scrollToPageBottom(page);
    exercised += 1;
  }

  return issues;
}

export async function runDemoFlow(page: Page, pageUrl: string): Promise<ValidationIssue[]> {
  if (!appConfig.demoMode) return [];

  const issues: ValidationIssue[] = [];
  await scrollToPageBottom(page);
  issues.push(...await exerciseVisibleTabs(page, pageUrl));
  await scrollToPageBottom(page);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })).catch(() => undefined);
  await waitBriefly(page);

  return issues;
}
