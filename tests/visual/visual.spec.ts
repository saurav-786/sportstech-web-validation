import { expect, test } from '../../src/fixtures/index.js';
import { appConfig } from '../../src/config.js';
import { safeFileName } from '../../src/utils/fs.js';

/**
 * @visual — screenshot regression with Playwright's built-in comparator.
 * First run writes baselines (tests/visual/visual.spec.ts-snapshots/);
 * commit them, then later runs fail on visual drift. Refresh with:
 *   npx playwright test tests/visual --update-snapshots
 */
test.describe('visual regression @visual', () => {
  test('key pages match visual baselines', async ({ page, dismissOverlays, sitePages }) => {
    const keyPages = sitePages.filter((p) => ['home', 'category', 'product', 'landing'].includes(p.category ?? '')).slice(0, 5);
    test.skip(keyPages.length === 0, 'no key pages discovered');

    for (const discovered of keyPages) {
      await page.goto(discovered.url, { waitUntil: 'load', timeout: appConfig.requestTimeoutMs });
      await dismissOverlays();
      // Neutralize animation/carousel noise before comparing
      await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; } [class*="carousel"], [class*="slider"], .swiper, video { visibility: hidden !important; }' });
      await page.waitForTimeout(800);
      await expect(page).toHaveScreenshot(`${safeFileName(discovered.url)}.png`, {
        fullPage: false,
        maxDiffPixelRatio: Number(process.env.VISUAL_MAX_DIFF ?? 0.02),
        timeout: 15_000
      });
    }
  });
});
