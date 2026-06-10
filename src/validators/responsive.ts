import type { Browser, BrowserContextOptions } from '@playwright/test';
import type { DeviceProfile, ValidationIssue } from '../types.js';
import { issue } from './common.js';

export async function validateResponsive(browser: Browser, pageUrl: string, devices: DeviceProfile[], screenshotDir: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  for (const device of devices) {
    const options: BrowserContextOptions = {
      viewport: { width: device.width, height: device.height },
      isMobile: device.isMobile,
      hasTouch: device.isMobile,
      ignoreHTTPSErrors: true
    };
    const context = await browser.newContext(options);
    const page = await context.newPage();
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null);
    await page.screenshot({ path: `${screenshotDir}/${device.name}.png`, fullPage: true }).catch(() => undefined);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 3).catch(() => false);
    if (overflow) {
      issues.push(issue('responsive', 'medium', pageUrl, `Horizontal overflow detected at ${device.name}.`, 'Constrain wide elements, media, tables, or carousels within the viewport.'));
    }

    const mobileNavVisible = device.isMobile
      ? await page.locator('button[aria-label*="menu" i], button:has-text("Menu"), [class*="hamburger"], [class*="burger"]').first().isVisible().catch(() => false)
      : true;
    if (!mobileNavVisible) {
      issues.push(issue('responsive', 'medium', pageUrl, `No mobile navigation trigger detected at ${device.name}.`, 'Expose a visible mobile menu button with an accessible name.'));
    }

    await context.close();
  }

  return issues;
}
