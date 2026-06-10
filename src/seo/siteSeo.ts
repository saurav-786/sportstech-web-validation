import type { APIRequestContext, Page } from '@playwright/test';
import { appConfig } from '../config.js';
import type { ValidationIssue } from '../types.js';
import { issue } from '../validators/common.js';

/** Site-level SEO: robots.txt, sitemap.xml. Run once per scan, not per page. */
export async function validateSiteSeo(request: APIRequestContext, baseUrl = appConfig.baseUrl): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const origin = new URL(baseUrl).origin;

  const robots = await request.get(`${origin}/robots.txt`).catch(() => null);
  if (!robots || robots.status() >= 400) {
    issues.push(issue('seo', 'medium', baseUrl, 'robots.txt is missing or unreachable.', 'Publish robots.txt with crawl rules and a Sitemap: directive.'));
  } else {
    const body = await robots.text();
    if (!/sitemap:/i.test(body)) {
      issues.push(issue('seo', 'low', baseUrl, 'robots.txt has no Sitemap: directive.', 'Reference sitemap.xml from robots.txt.'));
    }
    if (/disallow:\s*\/\s*$/im.test(body)) {
      issues.push(issue('seo', 'critical', baseUrl, 'robots.txt disallows the entire site.', 'Remove "Disallow: /" unless de-indexing is intentional.'));
    }
  }

  const sitemapUrls = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  let sitemapFound = false;
  for (const url of sitemapUrls) {
    const response = await request.get(url).catch(() => null);
    if (response && response.status() < 400) {
      sitemapFound = true;
      const xml = await response.text();
      if (!/<(urlset|sitemapindex)/.test(xml)) {
        issues.push(issue('seo', 'medium', url, 'Sitemap exists but is not valid XML.', 'Regenerate the sitemap with valid <urlset>/<sitemapindex> markup.'));
      }
      break;
    }
  }
  if (!sitemapFound) {
    issues.push(issue('seo', 'medium', baseUrl, 'No sitemap.xml found.', 'Generate and submit a sitemap to Search Console.'));
  }

  return issues;
}

/** Cross-page duplicate metadata + broken canonical detection. */
export async function findDuplicateMetadata(
  pages: Array<{ url: string; title: string; description: string; canonical: string }>,
  request: APIRequestContext
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const byTitle = new Map<string, string[]>();
  const byDescription = new Map<string, string[]>();

  for (const page of pages) {
    if (page.title) byTitle.set(page.title, [...(byTitle.get(page.title) ?? []), page.url]);
    if (page.description) byDescription.set(page.description, [...(byDescription.get(page.description) ?? []), page.url]);
    if (page.canonical) {
      const response = await request.get(page.canonical, { maxRedirects: 2 }).catch(() => null);
      if (!response || response.status() >= 400) {
        issues.push(issue('seo', 'high', page.url, `Canonical URL is broken (${response?.status() ?? 'unreachable'}): ${page.canonical}`, 'Point the canonical tag at a live, indexable URL.'));
      }
    }
  }
  for (const [title, urls] of byTitle) {
    if (urls.length > 1) issues.push(issue('seo', 'medium', urls[0], `Duplicate title on ${urls.length} pages: "${title.slice(0, 80)}"`, 'Write a unique title per page.', urls.join('\n')));
  }
  for (const [description, urls] of byDescription) {
    if (urls.length > 1) issues.push(issue('seo', 'low', urls[0], `Duplicate meta description on ${urls.length} pages.`, 'Write a unique meta description per page.', `${description.slice(0, 100)}…\n${urls.join('\n')}`));
  }
  return issues;
}

/** Extract per-page metadata for the duplicate scan. */
export async function extractSeoMeta(page: Page): Promise<{ url: string; title: string; description: string; canonical: string }> {
  return page.evaluate(() => ({
    url: location.href,
    title: document.title.trim(),
    description: document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content?.trim() ?? '',
    canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? ''
  }));
}
