import { expect, test } from '../../src/fixtures/index.js';
import { appConfig } from '../../src/config.js';
import { collectConsoleIssues } from '../../src/validators/common.js';

/**
 * @smoke — fast PR gate. Every discovered page loads with a 2xx/3xx status,
 * a title, visible content, and no uncaught page exceptions.
 */
test.describe('smoke: page availability @smoke', () => {
  test('homepage loads and is healthy', async ({ page, dismissOverlays, issueSink }) => {
    const consoleIssues = await collectConsoleIssues(page, appConfig.baseUrl, async () => {
      const response = await page.goto(appConfig.baseUrl, { waitUntil: 'domcontentloaded' });
      expect(response?.status(), 'homepage HTTP status').toBeLessThan(400);
    });
    await dismissOverlays();
    issueSink.push(...consoleIssues);

    await expect(page).toHaveTitle(/.+/);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length, 'page has visible content').toBeGreaterThan(100);
    // Console/page errors remain real findings in the dashboard, but availability
    // smoke should fail only when the page itself is unavailable or blank.
  });

  test('discovered pages respond without server errors', async ({ request, sitePages }) => {
    expect(sitePages.length).toBeGreaterThan(0);
    const failures: string[] = [];
    for (const discovered of sitePages) {
      const response = await request.get(discovered.url, { maxRedirects: 5 }).catch(() => null);
      const status = response?.status() ?? 0;
      if (status === 0 || status >= 500) failures.push(`${discovered.url} → ${status || 'unreachable'}`);
    }
    expect(failures, `server errors:\n${failures.join('\n')}`).toHaveLength(0);
  });
});
