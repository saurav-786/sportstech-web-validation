import type { Page } from '@playwright/test';
import type { ValidationIssue } from '../types.js';
import { issue } from './common.js';

export async function validateAnalytics(page: Page, pageUrl: string): Promise<ValidationIssue[]> {
  const tags = await page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    const scripts = Array.from(document.scripts).map((script) => script.src || script.textContent || '').join('\n');
    const source = `${html}\n${scripts}`;
    return {
      googleAnalytics: /gtag\(|google-analytics|G-[A-Z0-9]+|UA-\d+/i.test(source),
      googleTagManager: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/i.test(source),
      metaPixel: /connect\.facebook\.net|fbq\(/i.test(source),
      hotjar: /hotjar|hj\(/i.test(source),
      clarity: /clarity\.ms|clarity\(/i.test(source),
      crazyEgg: /crazyegg/i.test(source)
    };
  });

  const issues: ValidationIssue[] = [];
  if (!tags.googleAnalytics && !tags.googleTagManager) {
    issues.push(issue('analytics', 'medium', pageUrl, 'No Google Analytics or Google Tag Manager tag detected.', 'Install GTM or GA4 and validate events in debug mode.'));
  }
  if (tags.hotjar || tags.clarity || tags.crazyEgg) {
    issues.push(issue('heatmap', 'info', pageUrl, `Heatmap/session tool detected: ${Object.entries(tags).filter(([, value]) => value).map(([key]) => key).join(', ')}`, 'Confirm consent-mode behavior and sampling settings.'));
  } else {
    issues.push(issue('heatmap', 'low', pageUrl, 'No heatmap/session recording tool detected.', 'Consider Microsoft Clarity, Hotjar, or CrazyEgg for UX diagnostics.'));
  }

  return issues;
}
