import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateCategoryScores, calculateOverallHealthScore, calculateSeverityCounts,
  compareWithPreviousRun, mostAffectedArea
} from '../../src/reporting/score-engine.js';
import { scoreFromIssues } from '../../src/reports/html.js';
import { dedupeIssues } from '../../src/ai/analyzer.js';
import {
  checkoutCritical, criticalIssues, currentSummary, onlyLowIssues,
  previousSummary, repeatedTemplateIssues, result, zeroIssues
} from './fixtures.js';

test('severity counts tally every bucket', () => {
  const counts = calculateSeverityCounts(criticalIssues);
  assert.equal(counts.critical, 2);
  assert.equal(counts.high, 1);
  assert.equal(counts.medium, 0);
});

test('scoreFromIssues returns 100 for zero issues and stays within 0–100', () => {
  assert.equal(scoreFromIssues(zeroIssues, undefined, 5), 100);
  const low = scoreFromIssues(onlyLowIssues, undefined, 1);
  assert.ok(low > 0 && low <= 100, `expected 0<score<=100, got ${low}`);
  const crit = scoreFromIssues(criticalIssues, undefined, 1);
  assert.ok(crit >= 0 && crit <= 100);
});

test('health score never exceeds 100 or drops below 0', () => {
  const perfect = calculateOverallHealthScore({ seo: 100, accessibility: 100, performance: 100, security: 100, stability: 100, functional: 100, visual: 100 });
  assert.equal(perfect, 100);
  const worst = calculateOverallHealthScore({ seo: 0, accessibility: 0, performance: 0, security: 0, stability: 0, functional: 0, visual: 0 }, 20);
  assert.ok(worst >= 0 && worst <= 100, `got ${worst}`);
});

test('critical issues apply a release-readiness penalty to health', () => {
  const base = { seo: 90, accessibility: 90, performance: 90, security: 90, stability: 90, functional: 90, visual: 90 };
  const clean = calculateOverallHealthScore(base, 0);
  const withCriticals = calculateOverallHealthScore(base, 3);
  assert.ok(withCriticals < clean, 'criticals should lower health');
});

test('category scores cover all areas and stay bounded', () => {
  const scores = calculateCategoryScores(criticalIssues, [result({ passed: false })], 3);
  for (const key of ['seo', 'accessibility', 'performance', 'security', 'stability', 'functional', 'visual', 'health'] as const) {
    assert.ok(scores[key] >= 0 && scores[key] <= 100, `${key}=${scores[key]} out of range`);
  }
});

test('accessibility score is not 0 unless violations justify it', () => {
  const scores = calculateCategoryScores(onlyLowIssues, [result({})], 1);
  assert.ok(scores.accessibility > 50, `no a11y issues should keep score high, got ${scores.accessibility}`);
});

test('repeated template issue collapses to one pattern across pages', () => {
  const { groups } = dedupeIssues(repeatedTemplateIssues.map((i) => ({ ...i })));
  assert.equal(groups.length, 1, 'one repeated pattern expected');
  assert.equal(groups[0].count, 8);
});

test('most affected area is identified', () => {
  const top = mostAffectedArea(criticalIssues);
  assert.ok(top);
  assert.ok(['security', 'ui', 'accessibility'].includes(top!.area));
});

test('previous-run comparison yields direction indicators', () => {
  const deltas = compareWithPreviousRun(currentSummary, previousSummary);
  assert.equal(deltas.health.indicator, '▲');      // 70 → 75
  assert.equal(deltas.accessibility.indicator, '▼'); // 60 → 55
  assert.equal(deltas.stability.indicator, '→');     // 88 → 88
  assert.equal(compareWithPreviousRun(currentSummary).health.direction, 'new');
});

void checkoutCritical;
