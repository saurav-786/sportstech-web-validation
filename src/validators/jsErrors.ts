/**
 * jsErrors.ts — Phase 4: JavaScript error detection.
 *
 * Captures, classifies, de-duplicates and journey-maps client-side failures:
 *   - console errors
 *   - unhandled exceptions (pageerror)
 *   - unhandled promise rejections
 *   - failed network requests (4xx/5xx + request failures)
 *   - CSP violations
 *
 * Returns both structured JsErrorRecord[] (for the funnel/RCA layers) and
 * ValidationIssue[] (for the existing scoring/dashboard pipeline). It REUSES the
 * existing ValidationIssue contract — nothing in common.ts is replaced; this is
 * an additive, richer collector you opt into for journey runs.
 */

import type { Page, Request, Response } from '@playwright/test';
import type { FunnelStage, JsErrorRecord, ValidationIssue } from '../types.js';
import { funnelStageForUrl } from '../journeys/funnelMap.js';
import { classifyValidationIssue } from '../ai/failureClassification.js';

const NOISE = [
  /favicon/i,
  /google-analytics|googletagmanager|gtm\.js|doubleclick|facebook\.net|hotjar|clarity\.ms|cookiebot|usercentrics/i,
  /ResizeObserver loop/i
];

function isNoise(text: string): boolean {
  return NOISE.some((re) => re.test(text));
}

function severityFor(type: JsErrorRecord['type'], stage: FunnelStage | undefined): ValidationIssue['severity'] {
  const moneyStage = stage === 'checkout' || stage === 'payment' || stage === 'cart' || stage === 'add-to-cart';
  if (type === 'unhandled-exception') return moneyStage ? 'critical' : 'high';
  if (type === 'failed-request') return moneyStage ? 'high' : 'medium';
  if (type === 'csp-violation') return moneyStage ? 'high' : 'medium';
  if (type === 'promise-rejection') return moneyStage ? 'high' : 'medium';
  return moneyStage ? 'high' : 'medium'; // console-error
}

/**
 * Attaches listeners to a page and returns a collector. Call `stop()` after the
 * journey/run to obtain the de-duplicated records. `stageHint` lets a journey
 * label errors with the funnel stage it is currently exercising.
 */
export function attachJsErrorCollector(page: Page, stageHint?: () => FunnelStage | undefined) {
  const records = new Map<string, JsErrorRecord>();

  const add = (
    type: JsErrorRecord['type'],
    message: string,
    pageUrl: string,
    source?: string,
  ) => {
    if (!message || isNoise(message) || isNoise(source ?? '')) return;
    const stage = stageHint?.() ?? funnelStageForUrl(pageUrl);
    const key = `${type}::${message.slice(0, 160)}`;
    const existing = records.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    records.set(key, {
      type,
      message: message.slice(0, 400),
      pageUrl,
      funnelStage: stage,
      source,
      count: 1,
      firstSeen: new Date().toISOString(),
    });
  };

  const onConsole = (msg: import('@playwright/test').ConsoleMessage) => {
    const text = msg.text();
    if (msg.type() === 'error') {
      // Browsers surface CSP violations as console errors with a distinctive prefix.
      if (/content security policy|refused to (load|execute|connect)/i.test(text)) {
        add('csp-violation', text, page.url());
      } else {
        add('console-error', text, page.url());
      }
    }
  };
  const onPageError = (err: Error) => add('unhandled-exception', err.message, page.url(), err.stack?.split('\n')[1]?.trim());
  const onResponse = (res: Response) => {
    if (res.status() >= 400) {
      add('failed-request', `${res.status()} ${res.request().method()} ${res.url()}`, page.url(), res.url());
    }
  };
  const onRequestFailed = (req: Request) => {
    const failure = req.failure()?.errorText ?? 'request failed';
    if (/aborted|cancel/i.test(failure)) return; // user/nav-driven aborts are not defects
    add('failed-request', `${failure} ${req.method()} ${req.url()}`, page.url(), req.url());
  };

  // Unhandled promise rejections aren't surfaced via pageerror; hook window.
  void page.addInitScript(() => {
    window.addEventListener('unhandledrejection', (event) => {
      const reason = (event as PromiseRejectionEvent).reason;
      const msg = typeof reason === 'string' ? reason : reason?.message ?? JSON.stringify(reason);
      console.error(`[unhandledrejection] ${msg}`);
    });
  });
  const onRejectionConsole = (msg: import('@playwright/test').ConsoleMessage) => {
    const text = msg.text();
    if (text.startsWith('[unhandledrejection]')) {
      add('promise-rejection', text.replace('[unhandledrejection] ', ''), page.url());
    }
  };

  page.on('console', onConsole);
  page.on('console', onRejectionConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);

  return {
    records,
    stop(): JsErrorRecord[] {
      page.off('console', onConsole);
      page.off('console', onRejectionConsole);
      page.off('pageerror', onPageError);
      page.off('response', onResponse);
      page.off('requestfailed', onRequestFailed);
      return [...records.values()];
    },
  };
}

/** Convert structured JS error records into scoring-pipeline issues. */
export function jsErrorsToIssues(records: JsErrorRecord[]): ValidationIssue[] {
  return records.map((rec) => {
    const issue: ValidationIssue = {
    area: 'jserror',
    severity: severityFor(rec.type, rec.funnelStage),
    pageUrl: rec.pageUrl,
    summary: `${labelFor(rec.type)}${rec.count > 1 ? ` (×${rec.count})` : ''}: ${rec.message}`,
    evidence: rec.source,
    funnelStage: rec.funnelStage,
    failureClass: 'frontend',
    suggestedFix: fixFor(rec.type),
    };
    const classification = classifyValidationIssue(issue);
    const severity = classification.failureCategory === 'Third-party Dependency Issue' && issue.severity === 'critical'
      ? 'high'
      : classification.failureCategory === 'Environment/Network Issue'
        ? 'medium'
        : issue.severity;
    return { ...issue, ...classification, severity };
  });
}

function labelFor(type: JsErrorRecord['type']): string {
  return {
    'console-error': 'Console error',
    'unhandled-exception': 'Unhandled JS exception',
    'promise-rejection': 'Unhandled promise rejection',
    'failed-request': 'Failed network request',
    'csp-violation': 'CSP violation',
  }[type];
}

function fixFor(type: JsErrorRecord['type']): string {
  return {
    'console-error': 'Resolve the logged client-side error or suppress justified third-party noise.',
    'unhandled-exception': 'Add a guard/try-catch around the failing runtime path; inspect the stack trace.',
    'promise-rejection': 'Attach a .catch()/await try-catch to the rejecting promise; surface user-safe fallback.',
    'failed-request': 'Fix the endpoint, CORS, or retry policy; ensure the call is not on the critical path.',
    'csp-violation': 'Allow the blocked source in the Content-Security-Policy or remove the offending inline/script.',
  }[type];
}
