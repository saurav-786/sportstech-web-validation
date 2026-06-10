import type { Page } from '@playwright/test';
import type { ValidationIssue } from '../types.js';
import { issue } from './common.js';

export async function validateForms(page: Page, pageUrl: string): Promise<ValidationIssue[]> {
  const forms = await page.locator('form').evaluateAll((nodes) => nodes.map((form, index) => {
    const fields = Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select'));
    return {
      index,
      fields: fields.length,
      requiredWithoutLabel: fields.filter((field) => field.required && !field.labels?.length && !field.getAttribute('aria-label')).length,
      submitButtons: form.querySelectorAll('button[type="submit"], input[type="submit"], button:not([type])').length
    };
  })).catch(() => []);

  return forms.flatMap((form) => {
    const issues: ValidationIssue[] = [];
    if (form.fields > 0 && form.submitButtons === 0) {
      issues.push(issue('form', 'medium', pageUrl, `Form ${form.index + 1} has no submit button.`, 'Provide an explicit submit control.'));
    }
    if (form.requiredWithoutLabel > 0) {
      issues.push(issue('form', 'high', pageUrl, `Form ${form.index + 1} has required fields without labels.`, 'Associate required inputs with labels or aria-label text.'));
    }
    return issues;
  });
}
