import { expect, test } from '../../src/fixtures/index.js';
import { appConfig } from '../../src/config.js';
import { validateAccessibility, validateKeyboardAccess } from '../../src/validators/accessibility.js';

/** @accessibility — WCAG 2.1 A/AA via axe-core plus keyboard navigation and focus-visibility checks. */
test.describe('accessibility validation @accessibility', () => {
  test('WCAG scan and keyboard access on discovered pages', async ({ page, dismissOverlays, sitePages, issueSink }) => {
    const pages = sitePages.slice(0, Number(process.env.A11Y_MAX_PAGES ?? 8));
    test.setTimeout(Math.max(120_000, pages.length * 45_000));
    for (const discovered of pages) {
      const response = await page.goto(discovered.url, { waitUntil: 'domcontentloaded', timeout: appConfig.requestTimeoutMs }).catch(() => null);
      if (!response) {
        issueSink.push({ area: 'accessibility', severity: 'medium', pageUrl: discovered.url,
          summary: 'Accessibility scan skipped because navigation timed out.',
          failureCategory: 'Environment/Network Issue', codeFixNeeded: false, websiteFixNeeded: false, confidence: 75 });
        continue;
      }
      await dismissOverlays();
      const scan = await Promise.race([
        validateAccessibility(page, discovered.url),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('axe scan timeout')), 30_000)),
      ]).catch(() => [{
        area: 'accessibility' as const, severity: 'medium' as const, pageUrl: discovered.url,
        summary: 'Accessibility scan timed out before axe completed.',
        failureCategory: 'Automation Code Issue' as const, codeFixNeeded: true, websiteFixNeeded: false, confidence: 80,
      }]);
      issueSink.push(...scan, ...await validateKeyboardAccess(page, discovered.url));
    }
    const critical = issueSink.filter((issue) => issue.severity === 'critical');
    expect(critical, `critical a11y violations:\n${critical.map((issue) => `${issue.pageUrl}: ${issue.summary}`).join('\n')}`).toHaveLength(0);
  });
});
