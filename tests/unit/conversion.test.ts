import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFunnel, conversionHealth, funnelFromJourneys, priorityForDrop } from '../../src/conversion/funnelModel.js';
import { dropOffIssues } from '../../src/conversion/dropoff.js';
import type { JourneyResult } from '../../src/types.js';

function journey(reachedStage: JourneyResult['reachedStage']): JourneyResult {
  return {
    name: 'purchase', device: 'iphone-15', browser: 'webkit',
    startedAt: new Date().toISOString(), reachedStage,
    completed: reachedStage === 'payment' || reachedStage === 'order-complete',
    steps: [], issues: [], jsErrors: [], durationMs: 1000,
  };
}

test('funnelFromJourneys produces a stage per transition with monotonic entered counts', () => {
  const stages = funnelFromJourneys([journey('payment'), journey('cart'), journey('product-view')]);
  assert.equal(stages[0].stage, 'discovery');
  // entered counts must be non-increasing down the funnel
  for (let i = 1; i < stages.length; i += 1) {
    assert.ok(stages[i].entered <= stages[i - 1].entered, `stage ${i} entered <= previous`);
  }
});

test('all-payment journeys yield healthy funnel + high conversion health', () => {
  const f = buildFunnel([journey('payment'), journey('payment'), journey('payment')]);
  assert.ok(f.conversionHealthScore >= 90, `expected healthy, got ${f.conversionHealthScore}`);
  assert.ok(f.overallConversionRate > 0);
});

test('total block at add-to-cart is a P0', () => {
  // Everyone reaches product-view but nobody adds to cart.
  const stages = funnelFromJourneys([journey('product-view'), journey('product-view')]);
  const atc = stages.find((s) => s.stage === 'add-to-cart')!;
  const p = priorityForDrop('add-to-cart', atc.dropOffRate, 1 - (atc.baselineRate ?? 0.5));
  assert.equal(p, 'P0');
});

test('conversionHealth returns 100 when no stages populated', () => {
  assert.equal(conversionHealth([]), 100);
});

test('dropOffIssues emits conversion-area issues with funnelStage + revenueImpact', () => {
  const f = buildFunnel([journey('product-view'), journey('product-view'), journey('product-view')]);
  const issues = dropOffIssues(f);
  assert.ok(issues.length > 0);
  for (const i of issues) {
    assert.equal(i.area, 'conversion');
    assert.ok(i.funnelStage);
    assert.ok(i.revenueImpact);
  }
});
