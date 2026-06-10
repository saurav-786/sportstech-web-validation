import type { PageValidationResult, ValidationIssue } from '../../src/types.js';

/** Sample datasets for scoring/readiness unit tests. */

export function issue(partial: Partial<ValidationIssue>): ValidationIssue {
  return {
    area: 'ui', severity: 'low', pageUrl: 'https://example.com/', summary: 'sample',
    ...partial
  };
}

export function result(partial: Partial<PageValidationResult>): PageValidationResult {
  return { url: 'https://example.com/', browserName: 'chromium', passed: true, metrics: {}, issues: [], ...partial };
}

// 1. Zero issues — perfect site
export const zeroIssues: ValidationIssue[] = [];

// 2. Only low/info issues
export const onlyLowIssues: ValidationIssue[] = [
  issue({ area: 'seo', severity: 'low', summary: 'Title is long (70 chars).' }),
  issue({ area: 'image', severity: 'low', summary: 'Large image not lazy-loaded.' }),
  issue({ area: 'seo', severity: 'info', summary: 'Add Twitter card.' })
];

// 3. Multiple criticals
export const criticalIssues: ValidationIssue[] = [
  issue({ area: 'security', severity: 'critical', summary: 'Possible AWS access key exposed in page HTML.' }),
  issue({ area: 'ui', severity: 'critical', summary: 'Page returned HTTP 500.', pageUrl: 'https://example.com/laufband' }),
  issue({ area: 'accessibility', severity: 'high', summary: 'button-name: Buttons must have discernible text.' })
];

// 4. Repeated template issue across pages
export const repeatedTemplateIssues: ValidationIssue[] = Array.from({ length: 8 }, (_, i) =>
  issue({ area: 'image', severity: 'medium', summary: 'Image missing alt attribute: /product.png', pageUrl: `https://example.com/product-${i}` })
);

// 5. Previous-run summaries for comparison
export const previousSummary = { health: 70, seo: 80, accessibility: 60, performance: 75, security: 90, stability: 88 };
export const currentSummary = { health: 75, seo: 80, accessibility: 55, performance: 75, security: 95, stability: 88 };

// Critical journey failure (checkout)
export const checkoutCritical: ValidationIssue[] = [
  issue({ area: 'ui', severity: 'critical', summary: 'Checkout button broken', pageUrl: 'https://example.com/checkout', pageSection: 'checkout' })
];
