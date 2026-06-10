import type { Page } from '@playwright/test';
import { appConfig } from '../config.js';
import type { ValidationIssue, WebVitals } from '../types.js';
import { issue } from '../validators/common.js';

declare global {
  interface Window { __pwVitals?: { lcp: number; cls: number; tbt: number } }
}

/** Install observers before navigation so LCP/CLS/long-task data is captured. */
export async function installVitalsObservers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const vitals = { lcp: 0, cls: 0, tbt: 0 };
    window.__pwVitals = vitals;
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) vitals.lcp = last.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceEntry[]) {
          const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
          if (!shift.hadRecentInput) vitals.cls += shift.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > 50) vitals.tbt += entry.duration - 50;
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch { /* unsupported browser */ }
  });
}

/** Collect Core Web Vitals + resource metrics after the page settles. Chromium gives full data. */
export async function collectWebVitals(page: Page): Promise<WebVitals> {
  return page.evaluate((slowMs) => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const paint = performance.getEntriesByType('paint').find((entry) => entry.name === 'first-contentful-paint');
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const transferBytes = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0) + (nav?.transferSize ?? 0);
    const slowRequests = resources
      .filter((r) => r.duration > slowMs)
      .map((r) => ({ url: r.name.slice(0, 200), durationMs: Math.round(r.duration) }))
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 10);
    const renderBlocking = resources.filter((r) =>
      (r as PerformanceResourceTiming & { renderBlockingStatus?: string }).renderBlockingStatus === 'blocking').length;
    const vitals = window.__pwVitals;
    return {
      fcpMs: paint ? Math.round(paint.startTime) : undefined,
      lcpMs: vitals?.lcp ? Math.round(vitals.lcp) : undefined,
      cls: vitals ? Math.round(vitals.cls * 1000) / 1000 : undefined,
      tbtMs: vitals ? Math.round(vitals.tbt) : undefined,
      ttiMs: nav ? Math.round(nav.domInteractive) : undefined,
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : undefined,
      loadMs: nav ? Math.round(nav.loadEventEnd) : undefined,
      transferKb: Math.round(transferBytes / 1024),
      slowRequests,
      renderBlocking
    };
  }, appConfig.slowRequestMs);
}

/** Compare vitals to budgets and emit issues. */
export function vitalsToIssues(vitals: WebVitals, pageUrl: string): ValidationIssue[] {
  const { budgets } = appConfig;
  const issues: ValidationIssue[] = [];
  const over = (value: number | undefined, budget: number) => value !== undefined && value > budget;

  if (over(vitals.lcpMs, budgets.lcpMs)) issues.push(issue('performance', vitals.lcpMs! > budgets.lcpMs * 1.6 ? 'high' : 'medium', pageUrl, `LCP ${vitals.lcpMs}ms exceeds ${budgets.lcpMs}ms budget.`, 'Optimize hero image/preload critical assets; reduce server response time.'));
  if (over(vitals.fcpMs, budgets.fcpMs)) issues.push(issue('performance', 'medium', pageUrl, `FCP ${vitals.fcpMs}ms exceeds ${budgets.fcpMs}ms budget.`, 'Inline critical CSS and defer non-essential scripts.'));
  if (over(vitals.cls, budgets.cls)) issues.push(issue('performance', vitals.cls! > 0.25 ? 'high' : 'medium', pageUrl, `CLS ${vitals.cls} exceeds ${budgets.cls} budget.`, 'Reserve space for images, ads, embeds, and web fonts.'));
  if (over(vitals.tbtMs, budgets.tbtMs)) issues.push(issue('performance', 'medium', pageUrl, `TBT ${vitals.tbtMs}ms exceeds ${budgets.tbtMs}ms budget.`, 'Split long JavaScript tasks; defer third-party scripts.'));
  if (over(vitals.loadMs, budgets.loadMs)) issues.push(issue('performance', 'medium', pageUrl, `Full load ${vitals.loadMs}ms exceeds ${budgets.loadMs}ms budget.`, 'Reduce payload and request count.'));
  if (over(vitals.transferKb, budgets.transferKb)) issues.push(issue('performance', 'low', pageUrl, `Page weight ${vitals.transferKb}KB exceeds ${budgets.transferKb}KB budget.`, 'Compress images (WebP/AVIF), minify bundles, enable HTTP compression.'));
  if ((vitals.renderBlocking ?? 0) > 4) issues.push(issue('performance', 'low', pageUrl, `${vitals.renderBlocking} render-blocking resources.`, 'Defer/async non-critical CSS and JS.'));
  for (const slow of vitals.slowRequests ?? []) {
    issues.push(issue('performance', 'low', pageUrl, `Slow request (${slow.durationMs}ms): ${slow.url}`, 'Cache, compress, or move this call off the critical path.', slow.url));
  }
  return issues;
}
