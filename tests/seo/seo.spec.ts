import { expect, test } from '../../src/fixtures/index.js';
import { appConfig } from '../../src/config.js';
import { extractSeoMeta, findDuplicateMetadata, validateSiteSeo } from '../../src/seo/siteSeo.js';
import { validateSeo } from '../../src/validators/seo.js';

/** @seo — metadata, headings, canonicals, structured data, sitemap/robots, duplicates. */
test.describe('seo validation @seo', () => {
  test('site-level: robots.txt and sitemap.xml', async ({ request, issueSink }) => {
    const issues = await validateSiteSeo(request);
    issueSink.push(...issues);
    expect(issues.filter((issue) => issue.severity === 'critical'), 'no critical site-level SEO issues').toHaveLength(0);
  });

  test('page-level metadata, headings, and structured data', async ({ page, dismissOverlays, sitePages, issueSink, request }) => {
    const metas: Array<{ url: string; title: string; description: string; canonical: string }> = [];
    for (const discovered of sitePages) {
      await page.goto(discovered.url, { waitUntil: 'domcontentloaded', timeout: appConfig.requestTimeoutMs }).catch(() => null);
      await dismissOverlays();
      issueSink.push(...await validateSeo(page, discovered.url));
      metas.push(await extractSeoMeta(page).catch(() => ({ url: discovered.url, title: '', description: '', canonical: '' })));
    }
    issueSink.push(...await findDuplicateMetadata(metas, request));

    const blocking = issueSink.filter((issue) => ['critical', 'high'].includes(issue.severity));
    expect(blocking, `high-severity SEO issues:\n${blocking.map((issue) => `${issue.pageUrl}: ${issue.summary}`).join('\n')}`).toHaveLength(0);
  });
});
