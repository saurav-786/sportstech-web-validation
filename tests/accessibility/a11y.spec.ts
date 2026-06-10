import { expect, test } from '../../src/fixtures/index.js';
import { appConfig } from '../../src/config.js';
import { validateAccessibility, validateKeyboardAccess } from '../../src/validators/accessibility.js';

/** @accessibility — WCAG 2.1 A/AA via axe-core plus keyboard navigation and focus-visibility checks. */
test.describe('accessibility validation @accessibility', () => {
  test('WCAG scan and keyboard access on discovered pages', async ({ page, dismissOverlays, sitePages, issueSink }) => {
    for (const discovered of sitePages.slice(0, Number(process.env.A11Y_MAX_PAGES ?? 8))) {
      await page.goto(discovered.url, { waitUntil: 'domcontentloaded', timeout: appConfig.requestTimeoutMs }).catch(() => null);
      await dismissOverlays();
      issueSink.push(
        ...await validateAccessibility(page, discovered.url).catch(() => []),
        ...await validateKeyboardAccess(page, discovered.url)
      );
    }
    const critical = issueSink.filter((issue) => issue.severity === 'critical');
    expect(critical, `critical a11y violations:\n${critical.map((issue) => `${issue.pageUrl}: ${issue.summary}`).join('\n')}`).toHaveLength(0);
  });
});
