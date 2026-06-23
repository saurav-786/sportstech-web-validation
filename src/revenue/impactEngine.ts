/**
 * impactEngine.ts — Phase 7: Revenue Impact Analysis (pure, unit-tested).
 *
 * For every revenue-relevant issue, estimates: users impacted, funnel stage,
 * potential €/day, severity (P0–P3), affected devices, and a confidence score.
 *
 * Model: daily revenue baseline = dailySessions × baselineConversionRate × AOV.
 * An issue at funnel stage S caps the revenue flowing *through and past* S. The
 * fraction of revenue exposed by S is the share of conversions that must pass
 * through S (≈1.0 for every stage in a linear funnel) × the fraction of
 * sessions affected (device coverage × stage drop severity).
 */
import {
  FUNNEL_ORDER,
  type FunnelStage,
  type RevenueAssumptions,
  type RevenueImpact,
  type RevenuePriority,
  type ValidationIssue,
} from '../types.js';

const SEVERITY_TO_PRIORITY: Record<string, RevenuePriority> = {
  critical: 'P0', high: 'P1', medium: 'P2', low: 'P3', info: 'P3',
};

/** Share of sessions a stage failure plausibly affects, before device scaling. */
function stageExposure(stage: FunnelStage): number {
  // Earlier stages touch more sessions; later stages touch fewer but higher-intent.
  const idx = FUNNEL_ORDER.indexOf(stage);
  const map = [1.0, 0.7, 0.45, 0.4, 0.32, 0.3, 0.28]; // discovery → order-complete
  return map[idx] ?? 0.3;
}

/** P0 blocks all flow past the stage; lower priorities degrade a fraction. */
function severityFactor(priority: RevenuePriority): number {
  return ({ P0: 1.0, P1: 0.45, P2: 0.15, P3: 0.04 } as Record<RevenuePriority, number>)[priority];
}

export interface ImpactOptions {
  assumptions: RevenueAssumptions;
  totalDeviceCount?: number; // size of the device matrix, for device-scoped scaling
}

export function estimateImpact(issue: ValidationIssue, opts: ImpactOptions): RevenueImpact | undefined {
  const stage = issue.funnelStage ?? issue.revenueImpact?.funnelStage;
  if (!stage) return issue.revenueImpact; // only quantify funnel-mapped issues
  const priority: RevenuePriority = issue.revenueImpact?.priority ?? SEVERITY_TO_PRIORITY[issue.severity] ?? 'P3';

  const { assumptions } = opts;
  const canEstimateMoney = assumptions.connected
    && assumptions.dailySessions !== undefined
    && assumptions.baselineConversionRate !== undefined
    && assumptions.averageOrderValueEur !== undefined;
  const baselineDailyRevenue = canEstimateMoney
    ? assumptions.dailySessions! * assumptions.baselineConversionRate! * assumptions.averageOrderValueEur!
    : undefined;

  // Device scaling: an issue seen only on Mobile Safari affects ~that device's share.
  const devices = issue.revenueImpact?.affectedDevices ?? (issue.device ? [issue.device] : []);
  const deviceShare = devices.length && opts.totalDeviceCount
    ? Math.min(1, devices.length / opts.totalDeviceCount)
    : 1; // unknown coverage → assume all

  const exposure = stageExposure(stage);
  const factor = severityFactor(priority);
  const usersImpactedPct = Math.round(Math.min(100, exposure * factor * deviceShare * 100));
  const usersImpactedCount = assumptions.dailySessions !== undefined
    ? Math.round(assumptions.dailySessions * exposure * deviceShare)
    : undefined;
  const estDailyRevenueEur = baselineDailyRevenue !== undefined
    ? Math.round(baselineDailyRevenue * exposure * factor * deviceShare)
    : undefined;

  // Confidence: synthetic single-run evidence is moderate; explicit prior confidence wins.
  const confidence = issue.revenueImpact?.confidence
    ?? (priority === 'P0' ? 85 : priority === 'P1' ? 72 : 60);

  return {
    funnelStage: stage,
    priority,
    usersImpactedPct,
    usersImpactedCount,
    estDailyRevenueEur,
    affectedDevices: devices.length ? devices : undefined,
    confidence,
    rationale: baselineDailyRevenue !== undefined
      ? `${stage} exposure ${(exposure * 100).toFixed(0)}% × ${priority} severity × ${(deviceShare * 100).toFixed(0)}% device coverage on verified €${Math.round(baselineDailyRevenue).toLocaleString()}/day baseline.`
      : `Automation-observed ${stage} risk: ${priority} severity across ${(deviceShare * 100).toFixed(0)}% of tested devices. No monetary estimate without connected business data.`,
  };
}

/** Annotate a list of issues in place-style (returns new array) with revenue impact. */
export function enrichWithRevenueImpact(issues: ValidationIssue[], opts: ImpactOptions): ValidationIssue[] {
  return issues.map((i) => {
    const revenueImpact = estimateImpact(i, opts);
    return revenueImpact ? { ...i, revenueImpact } : i;
  });
}

/** Top revenue risks: verified money first, then observed priority/severity. */
export function topRevenueRisks(issues: ValidationIssue[], limit = 10): ValidationIssue[] {
  const priority = { P0: 4, P1: 3, P2: 2, P3: 1 };
  const severity = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
  return [...issues]
    .filter((i) => i.revenueImpact)
    .sort((a, b) =>
      ((b.revenueImpact?.estDailyRevenueEur ?? -1) - (a.revenueImpact?.estDailyRevenueEur ?? -1))
      || ((priority[b.revenueImpact!.priority] ?? 0) - (priority[a.revenueImpact!.priority] ?? 0))
      || ((severity[b.severity] ?? 0) - (severity[a.severity] ?? 0))
      || ((b.revenueImpact?.confidence ?? 0) - (a.revenueImpact?.confidence ?? 0)))
    .slice(0, limit);
}
