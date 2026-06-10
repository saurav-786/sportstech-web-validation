import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { enrichIssuesWithAi } from '../ai/rootCause.js';
import { appConfig } from '../config.js';
import { openReport } from '../reports/openReport.js';
import { writeSiteReports } from '../reports/siteReport.js';
import type { FailureClass, PageValidationResult, RunStats, ScrollMetrics, TestFailure, ValidationIssue } from '../types.js';
import { readJson } from '../utils/fs.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('suite-report');

/**
 * Merges tagged-suite outputs into the AI dashboard:
 *   reports/issues/*.json (validator findings) + reports/test-results.json (Playwright run)
 *   → AI enrichment (root cause, fixes) → self-healing suggestions for failed tests
 *   → reports/dashboard.html (auto-opened).
 */

// ---------- Playwright JSON parsing ----------

interface PwTestResult { status: string; error?: { message?: string }; errors?: Array<{ message?: string }>; }
interface PwTest { projectName?: string; status?: string; results: PwTestResult[]; }
interface PwSpec { title: string; tests: PwTest[]; }
interface PwSuite { title: string; specs?: PwSpec[]; suites?: PwSuite[]; }
interface PwReport { suites?: PwSuite[]; stats?: { expected: number; unexpected: number; flaky: number; skipped: number; duration: number }; }

function selfHealingAdvice(error: string): { failureClass: FailureClass; advice: string } {
  const text = error.toLowerCase();
  if (/tohavescreenshot|screenshot comparison|pixels.*differ|expected an image/.test(text)) {
    return { failureClass: 'frontend', advice: 'Visual drift detected. Review the diff in the trace; if the change is intentional run "npm run test:visual:update" to refresh baselines. If a carousel/animation caused it, extend the masked selectors in visual.spec.ts.' };
  }
  if (/strict mode violation/.test(text)) {
    return { failureClass: 'frontend', advice: 'Locator matches multiple elements. Heal by scoping with a role/name locator (page.getByRole) or .first(); avoid bare CSS classes.' };
  }
  if (/timeout.*waiting for|waiting for locator|locator.*not found|element.*not found/.test(text)) {
    return { failureClass: 'frontend', advice: 'Selector no longer matches the DOM. Heal by switching to resilient locators (getByRole/getByLabel/getByTestId) and adding data-testid attributes for unstable elements.' };
  }
  if (/not visible|intercepts pointer|element is outside of the viewport/.test(text)) {
    return { failureClass: 'frontend', advice: 'Element obscured by overlay/cookie banner. Heal by calling dismissOverlays() before interaction or scrollIntoViewIfNeeded().' };
  }
  if (/net::err|econnrefused|enotfound|dns|proxy|tunnel|browser has been closed/.test(text)) {
    return { failureClass: 'environment', advice: 'Network/environment failure, not a product bug. Verify connectivity/BASE_URL; rely on CI retries; consider raising REQUEST_TIMEOUT_MS.' };
  }
  if (/timeout|exceeded/.test(text)) {
    return { failureClass: 'flaky', advice: 'Timing-sensitive failure. Heal by replacing fixed waits with web-first assertions (expect(locator).toBeVisible()) and raising the per-test timeout only if the page is legitimately slow.' };
  }
  if (/5\d\d|internal server error/.test(text)) {
    return { failureClass: 'backend', advice: 'Server-side error. Route to the backend team with the trace; add an API-level monitor for this endpoint.' };
  }
  return { failureClass: 'frontend', advice: 'Inspect the attached trace (View Trace) for the failing step; convert brittle steps to role-based locators and web-first assertions.' };
}

function collectFailures(suite: PwSuite, path: string[], failures: TestFailure[], browsers: Set<string>): void {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests) {
      if (test.projectName) browsers.add(test.projectName);
      const lastResult = test.results[test.results.length - 1];
      const failed = test.status === 'unexpected' || lastResult?.status === 'failed' || lastResult?.status === 'timedOut';
      if (failed) {
        const error = lastResult?.error?.message ?? lastResult?.errors?.[0]?.message ?? 'Unknown error';
        const { failureClass, advice } = selfHealingAdvice(error);
        failures.push({
          test: [...path, suite.title, spec.title].filter(Boolean).join(' › '),
          browser: test.projectName ?? 'unknown',
          error: error.replace(/\[\d+m/g, '').slice(0, 500),
          failureClass,
          selfHealing: advice
        });
      }
    }
  }
  for (const child of suite.suites ?? []) collectFailures(child, [...path, suite.title].filter(Boolean), failures, browsers);
}

async function loadRunStats(): Promise<RunStats | undefined> {
  const path = join(appConfig.reportsDir, 'test-results.json');
  if (!existsSync(path)) {
    log.warn('No reports/test-results.json found — run the suites first.');
    return undefined;
  }
  const report = await readJson<PwReport>(path);
  const failures: TestFailure[] = [];
  const browsers = new Set<string>();
  for (const suite of report.suites ?? []) collectFailures(suite, [], failures, browsers);
  const stats = report.stats ?? { expected: 0, unexpected: failures.length, flaky: 0, skipped: 0, duration: 0 };
  return {
    total: stats.expected + stats.unexpected + stats.flaky + stats.skipped,
    passed: stats.expected,
    failed: stats.unexpected,
    flaky: stats.flaky,
    skipped: stats.skipped,
    durationMs: Math.round(stats.duration),
    browsers: [...browsers].sort(),
    failures
  };
}

// ---------- Issue merging ----------

async function loadSuiteIssues(): Promise<ValidationIssue[]> {
  const dir = join(appConfig.reportsDir, 'issues');
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((file) => file.endsWith('.json'));
  const issues: ValidationIssue[] = [];
  for (const file of files) {
    issues.push(...await readJson<ValidationIssue[]>(join(dir, file)).catch(() => []));
  }
  log.info(`Merged ${issues.length} issue(s) from ${files.length} suite file(s).`);
  return issues;
}

function groupIntoResults(issues: ValidationIssue[]): PageValidationResult[] {
  const byUrl = new Map<string, ValidationIssue[]>();
  for (const issue of issues) byUrl.set(issue.pageUrl, [...(byUrl.get(issue.pageUrl) ?? []), issue]);
  return [...byUrl.entries()].map(([url, pageIssues]) => ({
    url,
    browserName: 'suite',
    passed: !pageIssues.some((issue) => ['critical', 'high'].includes(issue.severity)),
    metrics: {},
    issues: pageIssues
  }));
}

async function loadTraversals(): Promise<ScrollMetrics[]> {
  const dir = join(appConfig.reportsDir, 'traversals');
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((file) => file.endsWith('.json'));
  const traversals: ScrollMetrics[] = [];
  for (const file of files) {
    const metric = await readJson<ScrollMetrics>(join(dir, file)).catch(() => null);
    if (metric) traversals.push(metric);
  }
  if (traversals.length) log.info(`Loaded ${traversals.length} page-exploration record(s).`);
  return traversals;
}

// ---------- Main ----------

const runStats = await loadRunStats();
const rawIssues = await loadSuiteIssues();
const traversals = await loadTraversals();
log.info('Running AI enrichment and building dashboard…');
const enriched = await enrichIssuesWithAi(rawIssues);
const results = groupIntoResults(enriched);
await writeSiteReports(results, [], runStats, traversals);
log.info(`Dashboard ready: ${resolve(appConfig.reportsDir, 'dashboard.html')}`);
await openReport(resolve(appConfig.reportsDir, 'dashboard.html'));
