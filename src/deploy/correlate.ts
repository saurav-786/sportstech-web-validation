/**
 * correlate.ts — Phase 10: deployment regression correlation.
 *
 * Joins deployment events against the conversion/error trend history and flags
 * a suspected regression when a conversion drop or error spike follows a deploy.
 * Reuses reports/history snapshots written by the existing pipeline (and the new
 * revenue snapshots) — no new storage layer.
 */
import type {
  DeploymentCorrelation,
  DeploymentEvent,
  ValidationIssue,
} from '../types.js';

export interface ConversionPoint {
  timestamp: string;
  conversionRate: number;   // 0–1
  errorCount?: number;
}

export interface CorrelateOptions {
  deployments: DeploymentEvent[];
  history: ConversionPoint[];          // chronological conversion snapshots
  averageOrderValueEur: number;
  dailySessions: number;
  moneyStageErrorsAfter?: ValidationIssue[]; // current run's money-stage JS errors
}

function nearest(points: ConversionPoint[], when: number, side: 'before' | 'after'): ConversionPoint | undefined {
  const sorted = [...points].sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp));
  if (side === 'before') return [...sorted].reverse().find((p) => +new Date(p.timestamp) <= when);
  return sorted.find((p) => +new Date(p.timestamp) >= when);
}

export function correlateDeployments(opts: CorrelateOptions): DeploymentCorrelation[] {
  const results: DeploymentCorrelation[] = [];
  for (const dep of opts.deployments) {
    const when = +new Date(dep.timestamp);
    const before = nearest(opts.history, when, 'before');
    const after = nearest(opts.history, when, 'after');

    if (!before || !after) {
      results.push({
        deployment: dep,
        confidence: 0,
        verdict: 'no-significant-change',
        likelyRootCause: 'Insufficient conversion history around this deployment.',
      });
      continue;
    }

    const deltaPct = before.conversionRate > 0
      ? ((after.conversionRate - before.conversionRate) / before.conversionRate) * 100
      : 0;
    const errorSpike = (after.errorCount ?? 0) > (before.errorCount ?? 0) * 1.5 + 2;

    // Revenue loss from the drop (only count drops).
    const lostConversions = Math.max(0, (before.conversionRate - after.conversionRate)) * opts.dailySessions;
    const revenueLoss = Math.round(lostConversions * opts.averageOrderValueEur);

    let verdict: DeploymentCorrelation['verdict'] = 'no-significant-change';
    let confidence = 30;
    let likelyRootCause: string | undefined;

    if (deltaPct <= -15 || (deltaPct <= -8 && errorSpike)) {
      verdict = 'regression-suspected';
      confidence = Math.min(95, 55 + Math.abs(deltaPct) + (errorSpike ? 15 : 0));
      const moneyErr = opts.moneyStageErrorsAfter?.find((i) => i.funnelStage === 'checkout' || i.funnelStage === 'payment');
      likelyRootCause = moneyErr
        ? `Likely ${moneyErr.area === 'jserror' ? 'checkout/payment JS error' : 'checkout regression'}: ${moneyErr.summary.slice(0, 140)}`
        : errorSpike ? 'Error spike coincides with the conversion drop after this deploy.'
          : 'Conversion dropped sharply immediately after this deployment.';
    } else if (deltaPct >= 10) {
      verdict = 'improvement';
      confidence = 60;
    }

    results.push({
      deployment: dep,
      conversionBefore: before.conversionRate,
      conversionAfter: after.conversionRate,
      conversionDeltaPct: Math.round(deltaPct * 100) / 100,
      revenueLossEstimateEur: verdict === 'regression-suspected' ? revenueLoss : 0,
      errorSpike,
      likelyRootCause,
      confidence: Math.round(confidence),
      verdict,
    });
  }
  return results;
}
