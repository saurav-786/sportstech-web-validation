import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { ValidationIssue } from '../types.js';
import { issue } from './common.js';

/** WCAG 2.1 A/AA scan via axe-core: alt text, contrast, ARIA, labels, landmarks, names. */
export async function validateAccessibility(page: Page, pageUrl: string): Promise<ValidationIssue[]> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();

  return result.violations.flatMap((violation) => {
    const severity = violation.impact === 'critical' ? 'critical' : violation.impact === 'serious' ? 'high' : violation.impact === 'moderate' ? 'medium' : 'low';
    return violation.nodes.slice(0, 8).map((node) => ({
      area: 'accessibility' as const,
      severity,
      pageUrl,
      summary: `${violation.id}: ${violation.help}`,
      evidence: node.target.join(', '),
      suggestedFix: violation.helpUrl
    }));
  });
}

/** Keyboard navigation + focus visibility checks axe cannot do statically. */
export async function validateKeyboardAccess(page: Page, pageUrl: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  const result = await page.evaluate(async () => {
    const focusable = Array.from(document.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter((el) => el.offsetParent !== null);
    const positiveTabIndex = focusable.filter((el) => Number(el.getAttribute('tabindex') ?? 0) > 0).length;
    return { focusableCount: focusable.length, positiveTabIndex };
  }).catch(() => ({ focusableCount: 0, positiveTabIndex: 0 }));

  if (result.focusableCount === 0) {
    issues.push(issue('accessibility', 'high', pageUrl, 'No keyboard-focusable elements detected.', 'Ensure interactive controls are native elements or have tabindex="0".'));
  }
  if (result.positiveTabIndex > 0) {
    issues.push(issue('accessibility', 'medium', pageUrl, `${result.positiveTabIndex} element(s) use positive tabindex.`, 'Use DOM order instead of positive tabindex values.'));
  }

  // Tab through first elements and verify visible focus indicators.
  let invisibleFocus = 0;
  const steps = Math.min(result.focusableCount, 10);
  for (let i = 0; i < steps; i += 1) {
    await page.keyboard.press('Tab').catch(() => undefined);
    const hasVisibleFocus = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return true;
      const style = getComputedStyle(el);
      const focusStyle = getComputedStyle(el, ':focus-visible');
      return style.outlineStyle !== 'none' || focusStyle.outlineStyle !== 'none'
        || style.boxShadow !== 'none' || el.matches(':focus-visible') === false;
    }).catch(() => true);
    if (!hasVisibleFocus) invisibleFocus += 1;
  }
  if (invisibleFocus > 2) {
    issues.push(issue('accessibility', 'medium', pageUrl, `${invisibleFocus}/${steps} tabbed elements have no visible focus indicator.`, 'Provide a clear :focus-visible outline on interactive elements.'));
  }

  return issues;
}
