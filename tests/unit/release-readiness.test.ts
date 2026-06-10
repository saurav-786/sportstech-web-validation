import assert from 'node:assert/strict';
import { test } from 'node:test';
import { determineReleaseReadiness } from '../../src/reporting/release-readiness.js';
import { calculateSeverityCounts } from '../../src/reporting/score-engine.js';
import { checkoutCritical, criticalIssues, result } from './fixtures.js';

const counts = (over: Partial<Record<'critical' | 'high' | 'medium' | 'low' | 'info', number>> = {}) =>
  ({ critical: 0, high: 0, medium: 0, low: 0, info: 0, ...over });

test('clean run with high scores is ready', () => {
  const r = determineReleaseReadiness({
    scores: { health: 95, security: 95, stability: 95 },
    severityCounts: counts(),
    issues: [], results: [result({ passed: true })]
  });
  assert.equal(r.verdict, 'ready');
});

test('any critical issue forces not-ready', () => {
  const r = determineReleaseReadiness({
    scores: { health: 95, security: 95, stability: 95 },
    severityCounts: calculateSeverityCounts(criticalIssues),
    issues: criticalIssues, results: [result({})]
  });
  assert.equal(r.verdict, 'not-ready');
  assert.ok(r.blockers.some((b) => /critical/i.test(b)));
});

test('low security score blocks release even with no criticals', () => {
  const r = determineReleaseReadiness({
    scores: { health: 88, security: 80, stability: 95 },
    severityCounts: counts({ high: 1 }),
    issues: [], results: [result({})]
  });
  assert.equal(r.verdict, 'not-ready');
  assert.ok(r.blockers.some((b) => /Security score/i.test(b)));
});

test('only medium/low issues with mid health is ready-with-warning', () => {
  const r = determineReleaseReadiness({
    scores: { health: 85, security: 90, stability: 90 },
    severityCounts: counts({ medium: 4, low: 6 }),
    issues: [], results: [result({})]
  });
  assert.equal(r.verdict, 'ready-with-warning');
});

test('broken checkout journey blocks release', () => {
  const r = determineReleaseReadiness({
    scores: { health: 92, security: 95, stability: 95 },
    severityCounts: calculateSeverityCounts(checkoutCritical),
    issues: checkoutCritical, results: [result({ url: 'https://example.com/checkout' })]
  });
  assert.equal(r.verdict, 'not-ready');
  assert.ok(r.blockers.some((b) => /journey|critical/i.test(b)));
});

test('key page load failure blocks release', () => {
  const r = determineReleaseReadiness({
    scores: { health: 92, security: 95, stability: 95 },
    severityCounts: counts(),
    issues: [], results: [result({ url: 'https://example.com/', status: 503, passed: false })]
  });
  assert.equal(r.verdict, 'not-ready');
  assert.ok(r.blockers.some((b) => /failed to load/i.test(b)));
});
