import type { Page } from '@playwright/test';
import type { ValidationIssue } from '../types.js';
import { issue } from './common.js';

export async function validateSeo(page: Page, pageUrl: string): Promise<ValidationIssue[]> {
  const data = await page.evaluate(() => {
    const meta = (selector: string) => document.querySelector<HTMLMetaElement>(selector)?.content?.trim() ?? '';
    const link = (selector: string) => document.querySelector<HTMLLinkElement>(selector)?.href ?? '';
    const jsonLd = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')).map((script) => script.textContent ?? '');
    return {
      title: document.title.trim(),
      description: meta('meta[name="description"]'),
      robots: meta('meta[name="robots"]'),
      canonical: link('link[rel="canonical"]'),
      h1: Array.from(document.querySelectorAll('h1')).map((node) => node.textContent?.trim()).filter(Boolean),
      h2Count: document.querySelectorAll('h2').length,
      h3Count: document.querySelectorAll('h3').length,
      ogTitle: meta('meta[property="og:title"]'),
      ogDescription: meta('meta[property="og:description"]'),
      twitterCard: meta('meta[name="twitter:card"]'),
      jsonLdCount: jsonLd.length,
      invalidJsonLd: jsonLd.filter((value) => {
        try {
          JSON.parse(value);
          return false;
        } catch {
          return true;
        }
      }).length
    };
  });

  const issues: ValidationIssue[] = [];
  if (!data.title) issues.push(issue('seo', 'high', pageUrl, 'Missing title tag.', 'Add a unique descriptive title.'));
  if (data.title.length > 65) issues.push(issue('seo', 'low', pageUrl, `Title is long (${data.title.length} chars).`, 'Keep titles near 50-60 characters.'));
  if (!data.description) issues.push(issue('seo', 'high', pageUrl, 'Missing meta description.', 'Add a unique meta description.'));
  if (data.description.length > 165) issues.push(issue('seo', 'low', pageUrl, `Meta description is long (${data.description.length} chars).`, 'Keep descriptions near 150-160 characters.'));
  if (!data.canonical) issues.push(issue('seo', 'medium', pageUrl, 'Missing canonical URL.', 'Add a canonical link tag.'));
  if (data.h1.length !== 1) issues.push(issue('seo', data.h1.length === 0 ? 'high' : 'medium', pageUrl, `Expected one H1, found ${data.h1.length}.`, 'Use one page-specific H1.'));
  if (!data.ogTitle || !data.ogDescription) issues.push(issue('seo', 'low', pageUrl, 'Missing Open Graph metadata.', 'Add og:title and og:description tags.'));
  if (!data.twitterCard) issues.push(issue('seo', 'low', pageUrl, 'Missing Twitter card metadata.', 'Add twitter:card metadata.'));
  if (data.invalidJsonLd > 0) issues.push(issue('seo', 'high', pageUrl, 'Invalid structured data JSON-LD detected.', 'Fix malformed schema markup.'));
  if (data.jsonLdCount === 0) issues.push(issue('seo', 'medium', pageUrl, 'No structured data detected.', 'Add product, breadcrumb, organization, or website schema where appropriate.'));

  return issues;
}
