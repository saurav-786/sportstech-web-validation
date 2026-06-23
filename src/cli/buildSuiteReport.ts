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
import { classifyTestFailure } from '../ai/failureClassification.js';

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

function collectFailures(suite: PwSuite, path: string[], failures: TestFailure[], browsers: Set<string>): void {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests) {
      if (test.projectName) browsers.add(test.projectName);
      const lastResult = test.results[test.results.length - 1];
      const failed = test.status === 'unexpected' || lastResult?.status === 'failed' || lastResult?.status === 'timedOut';
      if (failed) {
        const error = lastResult?.error?.message ?? lastResult?.errors?.[0]?.message ?? 'Unknown error';
        const testName = [...path, suite.title, spec.title].filter(Boolean).join(' › ');
        const classification = classifyTestFailure(testName, error, test.projectName ?? 'unknown');
        failures.push({
          test: testName,
          browser: test.projectName ?? 'unknown',
          error: error.replace(/\[\d+m/g, '').slice(0, 500),
          evidence: error.replace(/\[\d+m/g, '').slice(0, 500),
          failureClass: classification.failureClass,
          failureCategory: classification.failureCategory,
          rootCause: classification.rootCause,
          codeFixNeeded: classification.codeFixNeeded,
          websiteFixNeeded: classification.websiteFixNeeded,
          severity: classification.severity,
          confidence: classification.confidence,
          selfHealing: classification.advice,
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
