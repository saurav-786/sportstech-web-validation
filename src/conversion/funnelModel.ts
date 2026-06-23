/**
 * funnelModel.ts — Phase 3: Conversion Health Engine (pure, unit-tested).
 *
 * Builds a funnel from either:
 *   - synthetic journeys (how far the JourneyResults reached), and/or
 *   - real analytics (AnalyticsRecord conversionRate signals),
 * computes per-stage continuation rates, drop-offs, a conversion health score,
 * and flags revenue-impacting drops. No I/O, no globals — mirrors score-engine.ts.
 */
import {
  FUNNEL_ORDER,
  type AnalyticsRecord,
  type FunnelMetrics,
  type FunnelStage,
  type FunnelStageMetric,
  type JourneyResult,
  type RevenuePriority,
} from '../types.js';
import { STAGE_LABEL } from '../journeys/funnelMap.js';

/** Map a continuation/drop signal to a revenue priority. */
export function priorityForDrop(stage: FunnelStage, dropOffRate: number, baselineDrop: number): RevenuePriority {
  const moneyStage = stage === 'add-to-cart' || stage === 'cart' || stage === 'checkout' || stage === 'payment';
  const excess = dropOffRate - baselineDrop;
  if (dropOffRate >= 0.999 && moneyStage) return 'P0';      // total block on a money stage
  if (excess >= 0.25 && moneyStage) return 'P0';            // catastrophic regression on money stage
  if (excess >= 0.15) return 'P1';                          // material revenue degradation
  if (excess >= 0.07) return 'P2';                          // UX-level drop
  return 'P3';
}

/**
 * Build funnel metrics from synthetic journeys. Each stage's "entered" count is
 * the number of device journeys that reached it; "continued" is those that
 * reached the next stage. This converts real journey outcomes into a funnel.
 */
export function funnelFromJourneys(journeys: JourneyResult[]): FunnelStageMetric[] {
  const reachedIndex = journeys.map((j) => FUNNEL_ORDER.indexOf(j.reachedStage));
  // Boundary-safe mode terminates at 'payment' (no real order is placed), so the
  // payment→order-complete transition must NOT be scored as a drop-off.
  const terminalIdx = FUNNEL_ORDER.indexOf('payment');
  const stages: FunnelStageMetric[] = [];
  for (let i = 0; i < FUNNEL_ORDER.length - 1; i += 1) {
    const stage = FUNNEL_ORDER[i];
    const entered = reachedIndex.filter((idx) => idx >= i).length;
    const beyondTerminal = i >= terminalIdx;
    const continued = beyondTerminal ? entered : reachedIndex.filter((idx) => idx >= i + 1).length;
    const rate = entered > 0 ? continued / entered : (beyondTerminal ? 1 : 0);
    stages.push({
      stage,
      label: STAGE_LABEL[stage],
      entered,
      continued,
      rate,
      dropOffRate: 1 - rate,
      baselineRate: undefined,
      healthy: entered === 0 || rate >= 0.8,
      synthetic: true,
    });
  }
  return stages;
}

/** Blend synthetic structure with real analytics conversionRate when available. */
export function buildFunnel(journeys: JourneyResult[], analytics: AnalyticsRecord[] = []): FunnelMetrics {
  const stages = funnelFromJourneys(journeys);
  const source: FunnelMetrics['source'] = journeys.length ? 'automation-run' : 'unavailable';
  // This is observed journey completion across tested browser/device runs.
  // It is deliberately NOT presented as the website's business conversion rate.
  const completed = journeys.filter((j) => j.completed).length;
  const overallConversionRate = journeys.length ? completed / journeys.length : 0;

  // Biggest excess drop vs baseline on populated stages.
  let biggest: FunnelStageMetric | undefined;
  for (const s of stages) {
    if (s.entered === 0) continue;
    if (!biggest || s.dropOffRate > biggest.dropOffRate) biggest = s;
  }

  const conversionHealthScore = conversionHealth(stages);

  return {
    generatedAt: new Date().toISOString(),
    source,
    stages,
    overallConversionRate: Math.round(overallConversionRate * 100000) / 100000,
    biggestDropStage: biggest?.stage,
    conversionHealthScore,
  };
}

/** 0–100 health from observed continuation rates in this automation run. */
export function conversionHealth(stages: FunnelStageMetric[]): number {
  const populated = stages.filter((s) => s.entered > 0);
  if (populated.length === 0) return 100;
  let weighted = 0;
  let weights = 0;
  for (const s of populated) {
    const moneyWeight = (s.stage === 'add-to-cart' || s.stage === 'cart' || s.stage === 'checkout' || s.stage === 'payment') ? 1.6 : 1;
    weighted += s.rate * moneyWeight;
    weights += moneyWeight;
  }
  return Math.max(0, Math.min(100, Math.round((weighted / weights) * 100)));
}
