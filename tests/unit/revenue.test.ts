import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateImpact, enrichWithRevenueImpact, topRevenueRisks } from '../../src/revenue/impactEngine.js';
import { resolveAssumptions } from '../../src/revenue/assumptions.js';
import { correlateDeployments } from '../../src/deploy/correlate.js';
import { buildRevenueHealth } from '../../src/revenue/revenueHealth.js';
import type { JourneyResult, ValidationIssue } from '../../src/types.js';

const assumptions = {
  averageOrderValueEur: 200, dailySessions: 10000, baselineConversionRate: 0.02,
  source: 'manual' as const, connected: true, disclaimer: 'Connected test data.',
};

test('resolveAssumptions does not fabricate business metrics when no data is connected', () => {
  const a = resolveAssumptions([]);
  assert.equal(a.source, 'unavailable');
  assert.equal(a.connected, false);
  assert.equal(a.averageOrderValueEur, undefined);
});

test('page analytics alone remains incomplete without AOV', () => {
  const a = resolveAssumptions([{ url: '/', visits: 5000, conversionRate: 1.5, weight: 5 }]);
  assert.equal(a.source, 'unavailable');
  assert.equal(a.connected, false);
  assert.equal(a.dailySessions, 5000);
  assert.ok(Math.abs((a.baselineConversionRate ?? 0) - 0.015) < 1e-9);
});

test('P0 checkout issue estimates non-trivial daily revenue at risk', () => {
  const issue: ValidationIssue = {
    area: 'journey', severity: 'critical', pageUrl: '/checkout',
    summary: 'Checkout button broken', funnelStage: 'checkout',
  };
  const impact = estimateImpact(issue, { assumptions });
  assert.ok(impact);
  assert.equal(impact!.priority, 'P0');
  assert.ok((impact!.estDailyRevenueEur ?? 0) > 0);
  assert.ok(impact!.confidence >= 50);
});

test('issues without funnelStage are not quantified', () => {
  const issue: ValidationIssue = { area: 'seo', severity: 'low', pageUrl: '/', summary: 'missing meta' };
  assert.equal(estimateImpact(issue, { assumptions }), undefined);
});

test('money estimate is omitted when business data is unavailable', () => {
  const issue: ValidationIssue = {
    area: 'journey', severity: 'critical', pageUrl: '/checkout',
    summary: 'Checkout button broken', funnelStage: 'checkout',
  };
  const impact = estimateImpact(issue, {
    assumptions: { source: 'unavailable', connected: false, disclaimer: 'Unavailable' },
  });
  assert.ok(impact);
  assert.equal(impact!.estDailyRevenueEur, undefined);
  assert.match(impact!.rationale ?? '', /No monetary estimate/i);
});

test('topRevenueRisks sorts by modeled euros desc', () => {
  const issues = enrichWithRevenueImpact([
    { area: 'journey', severity: 'medium', pageUrl: '/cart', summary: 'cart slow', funnelStage: 'cart' },
    { area: 'journey', severity: 'critical', pageUrl: '/payment', summary: 'pay broken', funnelStage: 'payment' },
  ], { assumptions });
  const top = topRevenueRisks(issues);
  assert.ok((top[0].revenueImpact!.estDailyRevenueEur ?? 0) >= (top[1]?.revenueImpact?.estDailyRevenueEur ?? 0));
});

test('deployment correlation flags a sharp post-deploy conversion drop', () => {
  const res = correlateDeployments({
    deployments: [{ id: 'd1', timestamp: '2026-06-11T09:15:00Z' }],
    history: [
      { timestamp: '2026-06-11T08:00:00Z', conversionRate: 0.0175, errorCount: 1 },
      { timestamp: '2026-06-11T10:00:00Z', conversionRate: 0.008, errorCount: 12 },
    ],
    averageOrderValueEur: 200, dailySessions: 10000,
  });
  assert.equal(res[0].verdict, 'regression-suspected');
  assert.ok((res[0].revenueLossEstimateEur ?? 0) > 0);
  assert.ok(res[0].confidence >= 55);
});

test('buildRevenueHealth produces a bounded score and success percentages', () => {
  const journeys: JourneyResult[] = [
    { name: 'purchase', device: 'iphone-15', browser: 'webkit', startedAt: '', reachedStage: 'payment', completed: true, steps: [], issues: [], jsErrors: [], durationMs: 1 },
    { name: 'purchase', device: 'desktop-chrome', browser: 'chromium', startedAt: '', reachedStage: 'add-to-cart', completed: false, steps: [], issues: [], jsErrors: [], durationMs: 1 },
  ];
  const h = buildRevenueHealth({ journeys });
  assert.ok(h.revenueHealthScore >= 0 && h.revenueHealthScore <= 100);
  assert.ok(h.checkoutSuccessPct >= 0 && h.checkoutSuccessPct <= 100);
  assert.equal(h.funnel.stages.length, 6);
});
