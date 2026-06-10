import type { CategoryScores, PageValidationResult, ReleaseVerdict, Severity, ValidationIssue } from '../types.js';

export interface ReadinessInput {
  scores: Pick<CategoryScores, 'health' | 'security' | 'stability'>;
  severityCounts: Record<Severity, number>;
  issues: ValidationIssue[];
  results: PageValidationResult[];
}

export interface ReadinessResult {
  verdict: ReleaseVerdict;
  rationale: string;
  blockers: string[];
}

// Business-critical journeys whose failure blocks release regardless of overall score.
const CRITICAL_SECTIONS = new Set(['checkout', 'subscription', 'cart', 'login']);
const CRITICAL_PATH = /checkout|kasse|payment|cart|warenkorb|login|signin|anmelden|abo|subscription/i;

/**
 * Deterministic release gate (spec rules):
 *   not-ready  → any critical issue, OR health<80, OR security<85, OR stability<85,
 *                OR a broken critical journey (checkout/login/cart/subscription),
 *                OR homepage / product-listing page fails to load.
 *   ready      → no critical/high, health>=90, stability>=90, security>=90.
 *   otherwise  → ready-with-warning.
 */
export function determineReleaseReadiness(input: ReadinessInput): ReadinessResult {
  const { scores, severityCounts, issues, results } = input;
  const blockers: string[] = [];

  if (severityCounts.critical > 0) blockers.push(`${severityCounts.critical} critical issue(s) must be resolved before release.`);
  if (scores.health < 80) blockers.push(`Health score ${scores.health} is below the 80 release threshold.`);
  if (scores.security < 85) blockers.push(`Security score ${scores.security} is below the 85 release threshold.`);
  if (scores.stability < 85) blockers.push(`Stability score ${scores.stability} is below the 85 release threshold.`);

  const journeyFailure = issues.find((issue) =>
    issue.severity === 'critical' && (CRITICAL_SECTIONS.has(issue.pageSection ?? '') || CRITICAL_PATH.test(issue.pageUrl)));
  if (journeyFailure) blockers.push(`Critical failure in a business-critical journey: ${journeyFailure.summary} (${journeyFailure.pageUrl}).`);

  const keyPageDown = results.find((result) =>
    (result.url.replace(/\/$/, '').split('/').length <= 3 || /product|produkt|laufband|ergometer|rudergeraet|krafttraining|bikes/i.test(result.url))
    && (result.status ?? 200) >= 400);
  if (keyPageDown) blockers.push(`Key page failed to load (HTTP ${keyPageDown.status}): ${keyPageDown.url}.`);

  if (blockers.length > 0) {
    return { verdict: 'not-ready', rationale: blockers[0], blockers };
  }

  if (severityCounts.high === 0 && scores.health >= 90 && scores.stability >= 90 && scores.security >= 90) {
    return { verdict: 'ready', rationale: 'No critical/high issues; health, stability, and security all ≥ 90.', blockers: [] };
  }

  const warnings: string[] = [];
  if (severityCounts.high > 0) warnings.push(`${severityCounts.high} high-severity issue(s) present.`);
  if (scores.health < 90) warnings.push(`Health score ${scores.health} is below the 90 "ready" bar.`);
  return {
    verdict: 'ready-with-warning',
    rationale: warnings[0] ?? 'Releasable with documented warnings.',
    blockers: []
  };
}
