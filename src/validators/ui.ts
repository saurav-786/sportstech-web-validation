import type { Page, Response } from '@playwright/test';
import type { DeviceProfile, ValidationIssue } from '../types.js';
import { issue } from './common.js';

export async function validateUi(page: Page, pageUrl: string, response: Response | null, device: DeviceProfile): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const status = response?.status();
  if (!status) issues.push(issue('ui', 'high', pageUrl, 'No HTTP response was captured for page navigation.', 'Investigate redirects, service worker handling, or network failures.'));
  if (status && status >= 400) issues.push(issue('ui', status >= 500 ? 'critical' : 'high', pageUrl, `Page returned HTTP ${status}.`, 'Fix the failing route or redirect.'));

  const bodyText = (await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '')).trim();
  if (bodyText.length < 20) {
    issues.push(issue('ui', 'critical', pageUrl, `Possible blank page on ${device.name}.`, 'Check rendering, hydration, and route data dependencies.'));
  }

  const brokenResources = await page.evaluate(() => {
    return performance.getEntriesByType('resource')
      .filter((entry) => 'responseStatus' in entry && (entry as PerformanceResourceTiming & { responseStatus?: number }).responseStatus && (entry as PerformanceResourceTiming & { responseStatus?: number }).responseStatus! >= 400)
      .map((entry) => entry.name)
      .slice(0, 20);
  }).catch(() => []);

  for (const resource of brokenResources) {
    issues.push(issue('ui', 'medium', pageUrl, `Missing resource detected: ${resource}`, 'Fix the referenced asset or remove the stale dependency.', resource));
  }

  const invisibleIcons = await page.locator('svg, [class*="icon"], i').evaluateAll((nodes) =>
    nodes.filter((node) => {
      const style = getComputedStyle(node as HTMLElement);
      const rect = (node as HTMLElement).getBoundingClientRect();
      return rect.width === 0 || rect.height === 0 || style.visibility === 'hidden' || style.display === 'none';
    }).length
  ).catch(() => 0);

  if (invisibleIcons > 0) {
    issues.push(issue('ui', 'low', pageUrl, `${invisibleIcons} icon or SVG elements are hidden or zero-sized.`, 'Confirm hidden icons are intentional and visible controls retain accessible names.'));
  }

  return issues;
}
