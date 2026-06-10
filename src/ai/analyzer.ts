import { createHash } from 'node:crypto';
import type { AiAnalysis, AnalyticsRecord, FailureClass, Severity, SiteReport, ValidationIssue } from '../types.js';
import { createLogger } from '../utils/logger.js';
import { completeJson, parseJsonResponse } from './provider.js';

const log = createLogger('ai-analyzer');

const severityWeight: Record<Severity, number> = { critical: 50, high: 25, medium: 10, low: 4, info: 1 };

/** Heuristic failure classification — works with no API key. */
export function classifyIssue(issue: ValidationIssue): FailureClass {
  const text = `${issue.summary} ${issue.evidence ?? ''}`.toLowerCase();
  if (issue.area === 'security') return 'security';
  if (issue.area === 'seo') return 'seo';
  if (issue.area === 'performance' || issue.area === 'lighthouse') return 'performance';
  if (issue.area === 'accessibility') return 'accessibility';
  if (/timeout|net::err|dns|connection|proxy|tunnel|browser has been closed/.test(text)) return 'environment';
  if (/http 5\d\d|returned http 5|internal server|api .*fail/.test(text)) return 'backend';
  if (/missing alt|broken image|missing title|blank page|placeholder|lorem ipsum/.test(text)) return 'content';
  if (/intermittent|flaky|retry/.test(text)) return 'flaky';
  return 'frontend';
}

/** Stable signature for dedup: area + normalized summary (URLs/numbers stripped). */
export function issueSignature(issue: ValidationIssue): string {
  const normalized = issue.summary.replace(/https?:\/\/\S+/g, '<url>').replace(/\d+/g, '<n>').toLowerCase();
  return createHash('sha1').update(`${issue.area}|${normalized}`).digest('hex').slice(0, 12);
}

// Business-critical sections get a priority multiplier; above-the-fold is weighted higher.
const sectionMultiplier: Record<string, number> = {
  checkout: 2.0, subscription: 1.8, pricing: 1.7, cta: 1.6, hero: 1.5, 'product-listing': 1.4, content: 1.0
};
const positionMultiplier: Record<string, number> = {
  'above-fold': 1.3, 'hero': 1.3, 'mid-page': 1.1, 'near-footer': 1.0, 'footer': 0.9, 'lazy-loaded': 1.0, unknown: 1.0
};

/** Priority = severity × traffic weight × business-section × page-position. */
export function prioritizeIssues(issues: ValidationIssue[], analytics: AnalyticsRecord[] = []): ValidationIssue[] {
  const trafficByUrl = new Map(analytics.map((record) => [normalize(record.url), record.weight]));
  return issues.map((issue) => {
    const traffic = trafficByUrl.get(normalize(issue.pageUrl)) ?? 1;
    const section = sectionMultiplier[issue.pageSection ?? 'content'] ?? 1;
    const position = positionMultiplier[issue.pagePosition ?? 'unknown'] ?? 1;
    return {
      ...issue,
      signature: issueSignature(issue),
      failureClass: issue.failureClass ?? classifyIssue(issue),
      priorityScore: Math.round(severityWeight[issue.severity] * traffic * section * position * 10) / 10
    };
  }).sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
}

function normalize(url: string): string {
  try { const u = new URL(url); return `${u.hostname}${u.pathname}`.replace(/\/$/, ''); } catch { return url; }
}

/** Group duplicate issues across pages by signature; mark duplicates. */
export function dedupeIssues(issues: ValidationIssue[]): { issues: ValidationIssue[]; groups: AiAnalysis['duplicateGroups'] } {
  const bySignature = new Map<string, ValidationIssue[]>();
  for (const issue of issues) {
    const sig = issue.signature ?? issueSignature(issue);
    bySignature.set(sig, [...(bySignature.get(sig) ?? []), issue]);
  }
  const groups: AiAnalysis['duplicateGroups'] = [];
  const out: ValidationIssue[] = [];
  for (const [signature, group] of bySignature) {
    if (group.length > 1) {
      groups.push({ signature, count: group.length, pages: [...new Set(group.map((i) => i.pageUrl))].slice(0, 20) });
    }
    out.push(group[0], ...group.slice(1).map((dup) => ({ ...dup, duplicateOf: signature })));
  }
  return { issues: out, groups };
}

/** Full analysis: heuristics always; LLM enrichment when a key is configured. */
export async function analyzeReport(report: Omit<SiteReport, 'ai'>): Promise<AiAnalysis> {
  const prioritized = prioritizeIssues(report.issues, report.analytics);
  const { groups } = dedupeIssues(prioritized);
  const counts = countBySeverity(prioritized);

  const heuristic: AiAnalysis = {
    generatedAt: new Date().toISOString(),
    executiveSummary: buildHeuristicSummary(report, counts, groups),
    releaseReadiness: counts.critical > 0
      ? { verdict: 'not-ready', rationale: `${counts.critical} critical issue(s) must be resolved before release.` }
      : counts.high > 5
        ? { verdict: 'ready-with-risks', rationale: `${counts.high} high-severity issues present; release acceptable only with documented risk sign-off.` }
        : { verdict: 'ready', rationale: 'No critical issues and an acceptable high-severity count.' },
    topRisks: prioritized.slice(0, 5).map((issue) => `[${issue.severity}] ${issue.summary} (${issue.pageUrl})`),
    recommendedFixes: prioritized.filter((i) => !i.duplicateOf).slice(0, 10).map((issue) => ({
      issueSignature: issue.signature ?? '',
      fix: issue.suggestedFix ?? 'Investigate via the attached evidence and trace.'
    })),
    recommendedTests: recommendTestGaps(report),
    duplicateGroups: groups
  };

  const aiRaw = await completeJson(
    'You are a principal QA architect reviewing automated website-scan results. Return JSON: {"executiveSummary": string (<=180 words, written for management), "releaseReadiness": {"verdict": "ready"|"ready-with-risks"|"not-ready", "rationale": string}, "topRisks": string[5], "recommendedFixes": [{"issueSignature": string, "fix": string}], "recommendedTests": string[]}. Base verdicts only on the supplied data.',
    {
      baseUrl: report.baseUrl,
      pagesTested: report.pagesTested,
      scores: report.scores,
      severityCounts: counts,
      topIssues: prioritized.filter((i) => !i.duplicateOf).slice(0, 40).map(({ signature, severity, area, failureClass, pageUrl, summary, evidence }) =>
        ({ signature, severity, area, failureClass, pageUrl, summary, evidence: evidence?.slice(0, 150) })),
      duplicateGroups: groups.slice(0, 15)
    }
  );
  const enriched = parseJsonResponse<Partial<AiAnalysis>>(aiRaw);
  if (enriched) {
    log.info('LLM enrichment applied to analysis.');
    return { ...heuristic, ...enriched, generatedAt: heuristic.generatedAt, duplicateGroups: groups };
  }
  return heuristic;
}

function countBySeverity(issues: ValidationIssue[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  return counts;
}

function buildHeuristicSummary(report: Omit<SiteReport, 'ai'>, counts: Record<Severity, number>, groups: AiAnalysis['duplicateGroups']): string {
  const dominant = Object.entries(
    report.issues.reduce<Record<string, number>>((acc, issue) => ({ ...acc, [issue.area]: (acc[issue.area] ?? 0) + 1 }), {})
  ).sort((a, b) => b[1] - a[1])[0];
  return `Scanned ${report.pagesTested} page(s) on ${report.baseUrl}. Found ${report.issues.length} issue(s): `
    + `${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low. `
    + (dominant ? `Most issues fall in the "${dominant[0]}" area (${dominant[1]}). ` : '')
    + (groups.length > 0 ? `${groups.length} issue pattern(s) repeat across multiple pages, suggesting template-level fixes. ` : '')
    + `Health score: ${report.scores.health}/100.`;
}

/** Suggest tests for uncovered surface based on the website map data embedded in results. */
function recommendTestGaps(report: Omit<SiteReport, 'ai'>): string[] {
  const recommendations: string[] = [];
  const testedAreas = new Set(report.issues.map((issue) => issue.area));
  if (!testedAreas.has('form')) recommendations.push('Add form submission happy-path tests (newsletter, contact, search).');
  const has4xx = report.results.some((result) => (result.status ?? 200) >= 400);
  if (has4xx) recommendations.push('Add redirect-map regression tests for URLs returning 4xx/5xx.');
  const slowPages = report.results.filter((result) => (result.metrics.loadMs ?? 0) > 5_000);
  if (slowPages.length > 0) recommendations.push(`Add performance budget gates for ${slowPages.length} slow page(s) in CI.`);
  recommendations.push('Add checkout/cart user-journey tests with test payment data (currently excluded from crawl).');
  return recommendations;
}
