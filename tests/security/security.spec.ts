import { expect, test } from '../../src/fixtures/index.js';
import { appConfig } from '../../src/config.js';
import { probeXssSurface, validateCookies, validatePageSecurity, validateSecurity } from '../../src/validators/security.js';

/**
 * @security — HTTPS enforcement, security headers, cookie flags, mixed content,
 * sensitive data exposure, open-redirect surface, reflected-XSS probe.
 * Non-destructive: only safe GETs and a marker string typed into search fields.
 */
test.describe('security validation @security', () => {
  test('headers, cookies, and in-page security posture', async ({ page, context, request, dismissOverlays, sitePages, issueSink }) => {
    for (const discovered of sitePages.slice(0, Number(process.env.SECURITY_MAX_PAGES ?? 8))) {
      const response = await page.goto(discovered.url, { waitUntil: 'domcontentloaded', timeout: appConfig.requestTimeoutMs }).catch(() => null);
      await dismissOverlays();
      issueSink.push(
        ...await validateSecurity(request, discovered.url, response),
        ...await validateCookies(context, discovered.url),
        ...await validatePageSecurity(page, discovered.url)
      );
    }
    const critical = issueSink.filter((issue) => issue.severity === 'critical');
    expect(critical, `critical security findings:\n${critical.map((issue) => `${issue.pageUrl}: ${issue.summary}`).join('\n')}`).toHaveLength(0);
  });

  test('reflected XSS surface on search inputs', async ({ page, dismissOverlays, issueSink }) => {
    await page.goto(appConfig.baseUrl, { waitUntil: 'domcontentloaded' });
    await dismissOverlays();
    const issues = await probeXssSurface(page, appConfig.baseUrl);
    issueSink.push(...issues);
    expect(issues, 'no unescaped reflection of probe markup').toHaveLength(0);
  });
});
