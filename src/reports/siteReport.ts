/**
 * siteReport.ts — Aggregates page results into a SiteReport and writes all
 * HTML/JSON output artefacts under reports/.
 *
 * Exports:
 *   writeSiteReports — called by buildSuiteReport CLI and the main scan runner
 */

import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { enrichIssuesWithAi } from '../ai/rootCause.js';
import { appConfig } from '../config.js';
import { calculateCategoryScores, calculateSeverityCounts } from '../reporting/score-engine.js';
import { determineReleaseReadiness } from '../reporting/release-readiness.js';
import type {
  DiscoveredPage,
  PageValidationResult,
  RunStats,
  ScrollMetrics,
  SiteReport,
  ValidationIssue,
} from '../types.js';
import { ensureDir, writeJson } from '../utils/fs.js';
import { createLogger } from '../utils/logger.js';
import { writeAreaReport, scoreFromIssues } from './html.js';

const log = createLogger('site-report');

// ---------------------------------------------------------------------------
// Dashboard HTML
// ---------------------------------------------------------------------------

function severityColour(s: string): string {
  return ({ critical: '#d32f2f', high: '#e64a19', medium: '#f57c00', low: '#388e3c', info: '#0288d1' } as Record<string, string>)[s] ?? '#666';
}

function scoreColour(n: number): string {
  return n >= 90 ? '#388e3c' : n >= 70 ? '#f57c00' : '#d32f2f';
}

function badge(sev: string, count: number): string {
  return `<span style="background:${severityColour(sev)};color:#fff;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:600;margin-right:6px;">${sev.toUpperCase()} ${count}</span>`;
}

function buildDashboardHtml(report: SiteReport): string {
  const { scores, issues, results, ai, runStats } = report;
  const sevCounts = calculateSeverityCounts(issues);

  const scoreCards = Object.entries(scores)
    .map(([k, v]) => `
      <div class="score-card">
        <div class="score-num" style="color:${scoreColour(v)}">${v}</div>
        <div class="score-lbl">${k}</div>
      </div>`).join('');

  const issueRows = issues.slice(0, 200).map((i: ValidationIssue) => `
    <tr>
      <td><span style="background:${severityColour(i.severity)};color:#fff;padding:1px 7px;border-radius:3px;font-size:11px;font-weight:600;">${i.severity}</span></td>
      <td style="font-size:.78rem;word-break:break-all"><a href="${i.pageUrl}" target="_blank">${i.pageUrl}</a></td>
      <td>${i.area}</td>
      <td>${i.failureCategory ?? 'Real Website Issue'}<br/><span style="font-size:.7rem;color:#777">${i.confidence ?? '—'}% confidence · code ${i.codeFixNeeded ? 'yes' : 'no'} · website ${i.websiteFixNeeded === false ? 'no' : 'yes'}</span></td>
      <td>${i.summary}</td>
      <td style="font-size:.78rem"><strong>Cause:</strong> ${i.rootCause ?? 'See evidence.'}<br/><strong>Fix:</strong> ${i.suggestedFix ?? '—'}</td>
    </tr>`).join('');

  const failureRows = runStats?.failures?.slice(0, 50).map((f) => `
    <tr>
      <td style="font-size:.78rem">${f.test}</td>
      <td>${f.browser}</td>
      <td>${f.failureCategory}<br/><span style="font-size:.7rem;color:#777">${f.severity} · ${f.confidence}%</span></td>
      <td><code style="font-size:.75rem;white-space:pre-wrap">${f.error.slice(0, 200)}</code></td>
      <td style="font-size:.78rem">${f.rootCause}<br/><strong>Code fix:</strong> ${f.codeFixNeeded ? 'Yes' : 'No'} · <strong>Website fix:</strong> ${f.websiteFixNeeded ? 'Yes' : 'No'}</td>
      <td style="font-size:.78rem">${f.selfHealing}</td>
    </tr>`).join('') ?? '';

  const readiness = ai?.releaseReadiness;
  const verdictColour = readiness?.verdict === 'ready' ? '#388e3c' : readiness?.verdict === 'not-ready' ? '#d32f2f' : '#f57c00';
  const verdictBlock = readiness ? `
    <div class="card" style="border-left:4px solid ${verdictColour}">
      <h2 style="color:${verdictColour};margin-bottom:6px">Release: ${readiness.verdict}</h2>
      <p style="font-size:.85rem">${readiness.rationale}</p>
      ${(readiness.blockers ?? []).length ? `<ul style="margin-top:8px;padding-left:20px;font-size:.82rem">${(readiness.blockers ?? []).map((b: string) => `<li>${b}</li>`).join('')}</ul>` : ''}
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Validation Dashboard — ${report.baseUrl}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f6fa;color:#222;padding:24px}
  h1{font-size:1.5rem;margin-bottom:2px}
  h2{font-size:1rem;margin:20px 0 8px;color:#444}
  .meta{font-size:.78rem;color:#888;margin-bottom:20px}
  .card{background:#fff;border-radius:8px;padding:16px;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,.1)}
  .scores{display:flex;flex-wrap:wrap;gap:12px}
  .score-card{background:#fff;border-radius:8px;padding:12px 20px;box-shadow:0 1px 4px rgba(0,0,0,.08);min-width:110px;text-align:center}
  .score-num{font-size:2rem;font-weight:700}
  .score-lbl{font-size:.72rem;color:#888;text-transform:uppercase;margin-top:2px}
  table{width:100%;border-collapse:collapse;background:#fff;border-radius:6px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  th{background:#1565c0;color:#fff;text-align:left;padding:9px 11px;font-size:.74rem;text-transform:uppercase;letter-spacing:.4px}
  td{padding:8px 11px;font-size:.8rem;border-bottom:1px solid #eee;vertical-align:top}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:#f0f4ff}
  a{color:#1565c0;text-decoration:none}a:hover{text-decoration:underline}
  code{font-size:.78rem;background:#f0f0f0;padding:1px 4px;border-radius:3px}
  .summary{margin-bottom:8px;font-size:.85rem;line-height:1.5}
  .actions{display:flex;gap:10px;margin:0 0 18px}
  .download{display:inline-block;background:#1565c0;color:#fff;padding:9px 14px;border-radius:7px;font-size:.82rem;font-weight:700;text-decoration:none}
  @media print{
    .no-print{display:none!important}
    body{background:#fff;padding:0}
    .card,.score-card,table{box-shadow:none}
    table{table-layout:fixed}
    th,td{font-size:7.5pt;padding:6px;overflow-wrap:anywhere;word-break:normal}
    .issues-table th:nth-child(1),.issues-table td:nth-child(1){width:9%}
    .issues-table th:nth-child(2),.issues-table td:nth-child(2){width:24%}
    .issues-table th:nth-child(3),.issues-table td:nth-child(3){width:8%}
    .issues-table th:nth-child(4),.issues-table td:nth-child(4){width:16%}
    .issues-table th:nth-child(5),.issues-table td:nth-child(5){width:23%}
    .issues-table th:nth-child(6),.issues-table td:nth-child(6){width:20%}
  }
</style>
</head>
<body>
<h1>Validation Dashboard</h1>
<p class="meta">Generated ${report.generatedAt} · ${report.baseUrl} · Pages tested: ${report.pagesTested}</p>
<div class="actions no-print">
  <a class="download" href="executive-summary.pdf" download>Download PDF report</a>
  <a class="download" href="revenue-dashboard.html">Revenue &amp; Conversion dashboard</a>
</div>

${verdictBlock}

<div class="card">
  <h2 style="margin-top:0">Scores</h2>
  <div class="scores">${scoreCards}</div>
</div>

<div class="card">
  <h2 style="margin-top:0">Issue Summary</h2>
  <div>${Object.entries(sevCounts).map(([s, c]) => badge(s, c)).join('')}</div>
  <p class="meta" style="margin-top:8px">${issues.length} total · ${results.filter((r: PageValidationResult) => r.passed).length}/${results.length} pages passed</p>
</div>

${ai?.executiveSummary ? `<div class="card"><h2 style="margin-top:0">AI Executive Summary</h2><p class="summary">${ai.executiveSummary}</p></div>` : ''}

${runStats ? `
<div class="card">
  <h2 style="margin-top:0">Test Run</h2>
  <p class="meta">${runStats.passed} passed · ${runStats.failed} failed · ${runStats.flaky} flaky · ${runStats.skipped} skipped · ${Math.round(runStats.durationMs / 1000)}s · browsers: ${runStats.browsers.join(', ')}</p>
  ${runStats.failures.length ? `<h2>Failures + Self-Healing Advice</h2>
  <table>
    <thead><tr><th>Test</th><th>Browser</th><th>Classification</th><th>Evidence</th><th>Root Cause / Ownership</th><th>Recommended Fix</th></tr></thead>
    <tbody>${failureRows}</tbody>
  </table>` : ''}
</div>` : ''}

<h2>Issues (top 200)</h2>
<table class="issues-table">
  <thead><tr><th>Severity</th><th>URL</th><th>Area</th><th>Classification</th><th>Summary</th><th>Suggested Fix</th></tr></thead>
  <tbody>${issueRows || '<tr><td colspan="6" style="text-align:center;padding:24px;color:#888">No issues found.</td></tr>'}</tbody>
</table>

<p class="meta" style="margin-top:16px">
  Other reports:
  <a href="lighthouse-report.html">Lighthouse</a> ·
  <a href="performance-report.html">Performance</a> ·
  <a href="website-map.html">Site Map</a> ·
  <a href="playwright-report/index.html">Playwright</a>
</p>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Aggregates page validation results into a SiteReport, writes JSON and
 * HTML output files, and runs AI enrichment if API keys are configured.
 *
 * @param results   Per-page validation results.
 * @param pages     Discovered pages (optional; may be empty when called from suite reporter).
 * @param runStats  Playwright run statistics (optional).
 * @param traversals  Scroll/exploration metrics (optional).
 */
export async function writeSiteReports(
  results: PageValidationResult[],
  pages: DiscoveredPage[],
  runStats?: RunStats,
  traversals?: ScrollMetrics[],
): Promise<SiteReport> {
  await ensureDir(appConfig.reportsDir);

  const allIssues = results.flatMap((r) => r.issues);
  const pagesTested = Math.max(results.length, 1);

  // AI enrichment (no-ops when AI_PROVIDER=none)
  const enriched = await enrichIssuesWithAi(allIssues).catch((err: Error) => {
    log.warn(`AI enrichment skipped: ${err.message}`);
    return allIssues;
  });

  const enrichedResults: PageValidationResult[] = results.map((r) => ({
    ...r,
    issues: enriched.filter((i) => i.pageUrl === r.url),
  }));

  const scores = calculateCategoryScores(enriched, enrichedResults, pagesTested);
  const sevCounts = calculateSeverityCounts(enriched);

  const readiness = determineReleaseReadiness({
    scores,
    severityCounts: sevCounts,
    issues: enriched,
    results: enrichedResults,
  });

  // Build a minimal AiAnalysis block for the dashboard
  const ai = {
    generatedAt: new Date().toISOString(),
    executiveSummary: `Scanned ${pagesTested} page(s). Health score: ${scores.health}. Release verdict: ${readiness.verdict}.`,
    releaseReadiness: readiness,
    topRisks: enriched
      .filter((i) => i.severity === 'critical' || i.severity === 'high')
      .slice(0, 5)
      .map((i) => i.summary),
    recommendedFixes: [],
    recommendedTests: [],
    duplicateGroups: [],
  };

  const report: SiteReport = {
    generatedAt: new Date().toISOString(),
    baseUrl: appConfig.baseUrl,
    pagesTested,
    results: enrichedResults,
    issues: enriched,
    ai,
    runStats,
    traversals,
    scores: {
      health: scores.health,
      seo: scores.seo,
      accessibility: scores.accessibility,
      performance: scores.performance,
      security: scores.security,
      stability: scores.stability,
    },
  };

  // Write JSON
  const jsonPath = join(appConfig.reportsDir, 'site-report.json');
  await writeJson(jsonPath, report);
  log.info(`Site report JSON: ${resolve(jsonPath)}`);

  // Write area HTML reports
  await writeAreaReport(report, 'seo', 'SEO Report', join(appConfig.reportsDir, 'seo-report.html'));
  await writeAreaReport(report, 'accessibility', 'Accessibility Report', join(appConfig.reportsDir, 'a11y-report.html'));
  await writeAreaReport(report, 'security', 'Security Report', join(appConfig.reportsDir, 'security-report.html'));
  await writeAreaReport(report, 'performance', 'Performance Report', join(appConfig.reportsDir, 'performance-report.html'));

  // Write dashboard
  const dashPath = join(appConfig.reportsDir, 'dashboard.html');
  await writeFile(dashPath, buildDashboardHtml(report), 'utf8');
  log.info(`Dashboard: ${resolve(dashPath)}`);

  return report;
}
