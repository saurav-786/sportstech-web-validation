import type { CategoryScores, PageValidationResult, Severity, ValidationIssue } from '../types.js';
import { scoreFromIssues } from '../reports/html.js';

/**
 * Transparent scoring engine. Pure functions over normalized issues + page results,
 * reused by the report aggregator and unit-tested in isolation. No I/O, no globals.
 *
 * Health is a weighted blend of the seven category scores (spec default weighting);
 * each category score reuses the deduped, per-page-normalized scoreFromIssues model
 * so a single rule firing on many nodes/pages doesn't crater the score.
 */

export const HEALTH_WEIGHTS = {
  seo: 0.15,
  accessibility: 0.20,
  performance: 0.20,
  security: 0.20,
  stability: 0.15,
  functional: 0.05,
  visual: 0.05
} as const;

// Which validator areas roll up into the "functional" and "visual" buckets.
const FUNCTIONAL_AREAS: ValidationIssue['area'][] = ['ui', 'form', 'popup', 'image'];
const VISUAL_AREAS: ValidationIssue['area'][] = ['responsive'];

export function calculateSeverityCounts(issues: ValidationIssue[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  return counts;
}

function scoreForAreas(issues: ValidationIssue[], areas: ValidationIssue['area'][], pages: number): number {
  const subset = issues.filter((issue) => areas.includes(issue.area));
  return scoreFromIssues(subset, undefined, pages);
}

/** Stability from execution health: pass rate blended with a penalty for instability signals. */
export function calculateStabilityScore(results: PageValidationResult[], issues: ValidationIssue[], pages: number): number {
  if (results.length === 0) return 100;
  const passRate = (results.filter((result) => result.passed).length / results.length) * 100;
  // Penalize console errors, network failures, broken links/images, page-load failures.
  const instabilityIssues = issues.filter((issue) =>
    issue.area === 'ui' && /console|network|crash|did not load|http 5|exception|broken link/i.test(issue.summary));
  const penaltyScore = scoreFromIssues(instabilityIssues, undefined, pages);
  return clamp(Math.round(passRate * 0.6 + penaltyScore * 0.4));
}

export function calculateCategoryScores(issues: ValidationIssue[], results: PageValidationResult[], pagesTested: number): CategoryScores {
  const pages = Math.max(1, pagesTested);
  const seo = scoreFromIssues(issues, 'seo', pages);
  const accessibility = scoreFromIssues(issues, 'accessibility', pages);
  const performance = scoreFromIssues(issues, 'performance', pages);
  const security = scoreFromIssues(issues, 'security', pages);
  const functional = scoreForAreas(issues, FUNCTIONAL_AREAS, pages);
  const visual = scoreForAreas(issues, VISUAL_AREAS, pages);
  const stability = calculateStabilityScore(results, issues, pages);
  const health = calculateOverallHealthScore({ seo, accessibility, performance, security, stability, functional, visual });
  return { seo, accessibility, performance, security, stability, functional, visual, health };
}

/** Weighted blend → 0–100, with a release-readiness penalty when critical issues exist. */
export function calculateOverallHealthScore(scores: Omit<CategoryScores, 'health'>, criticalCount = 0): number {
  const weighted =
    scores.seo * HEALTH_WEIGHTS.seo +
    scores.accessibility * HEALTH_WEIGHTS.accessibility +
    scores.performance * HEALTH_WEIGHTS.performance +
    scores.security * HEALTH_WEIGHTS.security +
    scores.stability * HEALTH_WEIGHTS.stability +
    scores.functional * HEALTH_WEIGHTS.functional +
    scores.visual * HEALTH_WEIGHTS.visual;
  // Each unresolved critical shaves up to 5 points (capped at 25) — a release-readiness penalty.
  const criticalPenalty = Math.min(25, criticalCount * 5);
  return clamp(Math.round(weighted - criticalPenalty));
}

/** Area with the most issues — drives the "Most issues fall in …" line. */
export function mostAffectedArea(issues: ValidationIssue[]): { area: string; count: number } | null {
  const byArea = new Map<string, number>();
  for (const issue of issues) byArea.set(issue.area, (byArea.get(issue.area) ?? 0) + 1);
  const sorted = [...byArea.entries()].sort((a, b) => b[1] - a[1]);
  return sorted[0] ? { area: sorted[0][0], count: sorted[0][1] } : null;
}

export function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

export type TrendDirection = 'up' | 'down' | 'same' | 'new';

export interface MetricDelta { current: number; previous?: number; delta: number; direction: TrendDirection; indicator: '▲' | '▼' | '→' | '—'; }

/** Compare current vs previous numeric metrics → direction + indicator for the dashboard. */
export function compareWithPreviousRun(
  current: Record<string, number>,
  previous?: Record<string, number>
): Record<string, MetricDelta> {
  const out: Record<string, MetricDelta> = {};
  for (const [key, value] of Object.entries(current)) {
    const prev = previous?.[key];
    if (prev === undefined) { out[key] = { current: value, delta: 0, direction: 'new', indicator: '—' }; continue; }
    const delta = Math.round((value - prev) * 100) / 100;
    const direction: TrendDirection = delta > 0 ? 'up' : delta < 0 ? 'down' : 'same';
    out[key] = { current: value, previous: prev, delta, direction, indicator: delta > 0 ? '▲' : delta < 0 ? '▼' : '→' };
  }
  return out;
}
