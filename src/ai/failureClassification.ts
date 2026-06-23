import type { FailureCategory, FailureClass, Severity, TestFailure, ValidationIssue } from '../types.js';

interface Classification {
  failureClass: FailureClass;
  failureCategory: FailureCategory;
  rootCause: string;
  codeFixNeeded: boolean;
  websiteFixNeeded: boolean;
  severity: Severity;
  confidence: number;
  advice: string;
}

export function classifyTestFailure(test: string, error: string, browser: string): Omit<TestFailure, 'test' | 'browser' | 'error' | 'evidence' | 'selfHealing'> & { advice: string } {
  const text = `${test} ${error}`.toLowerCase();

  if (/tohavescreenshot|screenshot comparison|pixels.*differ|expected an image/.test(text)) {
    return result('frontend', 'Visual Regression Issue', 'Screenshot differs from the committed visual baseline after dynamic content stabilization.', false, true, 'high', 90,
      'Review the diff. Refresh the baseline only when the visual change is approved; otherwise route it to the website UI team.');
  }
  if (/accessibility|axe|aria-|wcag|color-contrast/.test(text)) {
    return result('accessibility', 'Accessibility Issue', 'The live DOM violates an accessibility rule or the accessibility scan could not complete.', false, true, 'high', 90,
      'Fix the reported WCAG/ARIA defect. If only the scan timed out, reduce per-page scope and capture it as an automation issue.');
  }
  if (/lcp|cls|inp|ttfb|tbt|performance|budget breach/.test(text)) {
    return result('performance', 'Performance Issue', 'Measured live performance exceeded the configured budget.', false, true, 'high', 88,
      'Use the measured vitals and trace to optimize the responsible page resources or server response.');
  }
  if (/third.?party|fontawesome|tiktok|zendesk|doofinder|clarity|hotjar|doubleclick|facebook|cloudfront|jsdelivr/.test(text)) {
    return result('environment', 'Third-party Dependency Issue', 'An external script, CDN, analytics, or service dependency failed during the run.', false, true, 'medium', 85,
      'Confirm vendor availability/CORS/CSP and ensure critical commerce paths degrade safely when the dependency fails.');
  }
  if (/net::err|econnrefused|enotfound|name_not_resolved|dns|proxy|tunnel|ns_error|tls error|err_timed_out/.test(text)) {
    return result('environment', 'Environment/Network Issue', `The ${browser} run lost connectivity or the target could not be resolved reliably.`, false, false, 'medium', 82,
      'Retry from a stable runner and retain the network log. Escalate to the website team only if the failure reproduces across environments.');
  }
  // A navigation/goto timeout to a reachable host means the PAGE did not load within
  // budget — that is a real website performance problem, not brittle automation.
  // Checked BEFORE the generic-timeout branch so slow pages are not blamed on the test.
  if ((/goto|navigat|page\.reload/.test(text)) && /timeout|timed out|exceeded/.test(text)) {
    return result('performance', 'Performance Issue', `Navigation to the page did not complete within the configured timeout on ${browser} (page too slow or unresponsive).`, false, true, 'high', 80,
      'Treat as a website load-time defect: profile TTFB/render-blocking resources for this URL. Raise REQUEST_TIMEOUT_MS only after confirming the page is legitimately, acceptably slow.');
  }
  // Test-level budget exceeded, brittle locator, strict-mode, or a context torn down by
  // the harness ("browser has been closed" / "target page closed") = automation-side.
  if (/strict mode violation|waiting for locator|locator.*not found|element.*not found|test timeout|timeout of \d+ms exceeded|timed out|browser has been closed|target page.*closed|context.*has been closed/.test(text)) {
    return result('flaky', 'Automation Code Issue', 'The test exceeded its own time budget, used a brittle locator/broad operation, or had its context torn down by the harness — it did not synchronize with the page.', true, false, 'medium', 82,
      'Use scoped role/label/test-id locators, web-first assertions, and per-page timeout isolation instead of fixed waits or one oversized loop.');
  }
  if (/5\d\d|internal server error|bad gateway|service unavailable/.test(text)) {
    return result('backend', 'Real Website Issue', 'The tested website or its first-party API returned a server error.', false, true, 'critical', 92,
      'Route the response, URL, timestamp, and trace to the website/backend team.');
  }
  if (/revenue|checkout|payment|cart|add.to.cart/.test(text)) {
    return result('frontend', 'Revenue Risk Issue', 'A live commerce journey step did not complete successfully.', false, true, 'critical', 88,
      'Use the failed step, screenshot, console, and network evidence to repair the customer journey.');
  }
  return result('frontend', 'Real Website Issue', 'The live website did not satisfy the tested functional expectation.', false, true, 'high', 72,
    'Inspect the trace and evidence; change automation only if the locator or assertion does not represent the intended user behavior.');
}

export function classifyValidationIssue(issue: ValidationIssue): Pick<ValidationIssue,
  'failureCategory' | 'codeFixNeeded' | 'websiteFixNeeded' | 'confidence' | 'rootCause'> {
  const text = `${issue.summary} ${issue.evidence ?? ''}`.toLowerCase();
  let failureCategory: FailureCategory = 'Real Website Issue';
  let codeFixNeeded = false;
  let websiteFixNeeded = true;
  let confidence = issue.confidence ?? 85;
  let rootCause = issue.rootCause ?? 'The live website did not satisfy the measured validation rule.';

  if (issue.area === 'accessibility') {
    failureCategory = 'Accessibility Issue';
    rootCause = issue.rootCause ?? 'The rendered DOM violates the referenced WCAG or ARIA requirement.';
  } else if (issue.area === 'performance' || issue.area === 'lighthouse') {
    failureCategory = 'Performance Issue';
    rootCause = issue.rootCause ?? 'Measured page timing or resource cost exceeded the configured performance budget.';
  } else if (issue.area === 'conversion' || issue.area === 'revenue' || issue.area === 'journey') {
    failureCategory = 'Revenue Risk Issue';
    rootCause = issue.rootCause ?? 'A live automation step in the commerce funnel did not complete successfully.';
  } else if (/fontawesome|tiktok|zendesk|doofinder|clarity|hotjar|doubleclick|facebook|cloudfront|jsdelivr|third.?party/.test(text)) {
    failureCategory = 'Third-party Dependency Issue';
    rootCause = issue.rootCause ?? 'An external vendor script, CDN, analytics, or widget dependency failed.';
  }
  else if (/net::err|dns|name_not_resolved|unknown host|tls error|proxy|tunnel|network request failed/.test(text)) {
    failureCategory = 'Environment/Network Issue';
    websiteFixNeeded = false;
    confidence = 75;
    rootCause = issue.rootCause ?? 'The runner could not reliably resolve or connect to the requested host.';
  } else if (/timeout|strict mode violation|locator.*not found/.test(text)) {
    failureCategory = 'Automation Code Issue';
    codeFixNeeded = true;
    websiteFixNeeded = false;
    confidence = 75;
    rootCause = issue.rootCause ?? 'The automation did not synchronize with the page or used an unstable locator.';
  }

  return { failureCategory, codeFixNeeded, websiteFixNeeded, confidence, rootCause };
}

function result(
  failureClass: FailureClass,
  failureCategory: FailureCategory,
  rootCause: string,
  codeFixNeeded: boolean,
  websiteFixNeeded: boolean,
  severity: Severity,
  confidence: number,
  advice: string,
): Classification {
  return { failureClass, failureCategory, rootCause, codeFixNeeded, websiteFixNeeded, severity, confidence, advice };
}
