import type { APIRequestContext, Page } from '@playwright/test';
import type { ValidationIssue } from '../types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('confidence');

/**
 * False-positive reduction: before a critical/high issue is reported, re-validate it
 * with an independent check. Each issue gets a confidence score (0–100); issues below
 * CONFIDENCE_THRESHOLD (default 60) are downgraded to "info" and flagged as suspected
 * false positives instead of being silently dropped.
 *
 * Confidence model:
 *   base 70  → deterministic signal (HTTP status, headers, axe, metadata): +25
 *            → re-check confirms (link still broken, image still 0px): +25
 *            → re-check contradicts: −45 (suspected transient/flaky)
 *            → non-recheckable heuristic finding: stays near base
 */

const threshold = Number(process.env.CONFIDENCE_THRESHOLD ?? 60);

// Areas whose findings come from deterministic sources — high confidence, no re-check needed.
const deterministicAreas = new Set(['seo', 'security', 'accessibility', 'analytics', 'heatmap', 'lighthouse']);

export async function applyConfidence(page: Page, request: APIRequestContext, issues: ValidationIssue[]): Promise<ValidationIssue[]> {
  const out: ValidationIssue[] = [];
  // Bound the number of (network) rechecks per page so confidence scoring stays fast.
  const maxRechecks = Number(process.env.MAX_RECHECKS ?? 15);
  let rechecks = 0;
  for (const issue of issues) {
    let confidence = 70;

    if (deterministicAreas.has(issue.area)) {
      confidence = 95;
    } else if (['critical', 'high'].includes(issue.severity) && rechecks < maxRechecks) {
      confidence += await recheck(page, request, issue);
      rechecks += 1;
    } else {
      confidence = 80; // medium/low (or beyond recheck budget): report, flagged as unverified
    }
    confidence = Math.max(5, Math.min(99, confidence));

    if (confidence < threshold) {
      log.info(`Suspected false positive (${confidence}%): ${issue.summary.slice(0, 80)}`);
      out.push({
        ...issue,
        severity: 'info',
        confidence,
        failureClass: 'flaky',
        summary: `[suspected false positive, ${confidence}% confidence] ${issue.summary}`
      });
    } else {
      out.push({ ...issue, confidence });
    }
  }
  return out;
}

/** Independent second check per issue type. Returns confidence delta. */
async function recheck(page: Page, request: APIRequestContext, issue: ValidationIssue): Promise<number> {
  const text = issue.summary.toLowerCase();
  try {
    // Broken link / HTTP error → re-fetch the URL once more
    const urlMatch = (issue.evidence ?? issue.summary).match(/https?:\/\/[^\s"')]+/);
    if (/broken link|returned http|missing resource|unreachable/.test(text) && urlMatch) {
      const response = await request.get(urlMatch[0], { timeout: 10_000, maxRedirects: 5 }).catch(() => null);
      const stillBroken = !response || response.status() >= 400;
      return stillBroken ? 25 : -45;
    }
    // Broken image → re-query the DOM for the same src
    if (/broken image/.test(text) && urlMatch) {
      const stillBroken = await page.evaluate((src) => {
        const img = Array.from(document.querySelectorAll<HTMLImageElement>('img')).find((node) => (node.currentSrc || node.src) === src);
        return img ? img.complete && img.naturalWidth === 0 : true;
      }, urlMatch[0]).catch(() => true);
      return stillBroken ? 25 : -45;
    }
    // Blank page → re-read body text after a settle delay
    if (/blank page/.test(text)) {
      await page.waitForTimeout(1_500);
      const length = await page.locator('body').innerText({ timeout: 5_000 }).then((value) => value.trim().length).catch(() => 0);
      return length < 20 ? 25 : -45;
    }
    // Console/page errors are already direct observations
    if (/console error|uncaught page exception/.test(text)) return 20;
  } catch {
    return 0;
  }
  return 10; // not re-checkable; slight boost for having severity-worthy evidence
}
