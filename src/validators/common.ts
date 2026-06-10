import type { ConsoleMessage, Page } from '@playwright/test';
import type { ValidationIssue } from '../types.js';

export async function collectConsoleIssues(page: Page, pageUrl: string, run: () => Promise<void>): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  const pageErrorHandler = (error: Error) => {
    issues.push({
      area: 'ui',
      severity: 'high',
      pageUrl,
      summary: `Uncaught page exception: ${error.message}`,
      suggestedFix: 'Inspect browser stack trace and guard the failing runtime path.'
    });
  };

  const consoleHandler = (message: ConsoleMessage) => {
    if (message.type() === 'error') {
      issues.push({
        area: 'ui',
        severity: 'medium',
        pageUrl,
        summary: `Console error: ${message.text().slice(0, 220)}`,
        suggestedFix: 'Fix the logged client-side error or suppress noisy third-party failures with justification.'
      });
    }
  };

  page.on('pageerror', pageErrorHandler);
  page.on('console', consoleHandler);

  try {
    await run();
  } finally {
    page.off('pageerror', pageErrorHandler);
    page.off('console', consoleHandler);
  }

  return issues;
}

export function issue(area: ValidationIssue['area'], severity: ValidationIssue['severity'], pageUrl: string, summary: string, suggestedFix?: string, evidence?: string): ValidationIssue {
  return { area, severity, pageUrl, summary, suggestedFix, evidence };
}
