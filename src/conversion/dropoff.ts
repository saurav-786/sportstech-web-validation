/**
 * dropoff.ts — Phase 3: turn funnel drop-offs into ValidationIssues with
 * revenue priority (P0–P3), feeding the existing scoring/dashboard pipeline.
 */
import type { FunnelMetrics, ValidationIssue } from '../types.js';
import { appConfig } from '../config.js';
import { priorityForDrop } from './funnelModel.js';

const PRIORITY_SEVERITY: Record<string, ValidationIssue['severity']> = {
  P0: 'critical', P1: 'high', P2: 'medium', P3: 'low',
};

export function dropOffIssues(funnel: FunnelMetrics, baseUrl = appConfig.baseUrl): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const s of funnel.stages) {
    if (s.entered === 0) continue;
    if (s.dropOffRate < 0.01) continue;
    const priority = priorityForDrop(s.stage, s.dropOffRate, 0);
    issues.push({
      area: 'conversion',
      severity: PRIORITY_SEVERITY[priority],
      pageUrl: baseUrl,
      summary: `Automation journey drop-off at "${s.label}": ${s.continued}/${s.entered} tested runs advanced (${(s.rate * 100).toFixed(0)}% success).`,
      suggestedFix: `Investigate the ${s.label} → next-stage transition using the failed run evidence. This is automation-run coverage, not business conversion data.`,
      funnelStage: s.stage,
      failureClass: 'frontend',
      revenueImpact: {
        funnelStage: s.stage,
        priority,
        usersImpactedPct: Math.round(s.dropOffRate * 100),
        confidence: s.synthetic ? 70 : 88,
        rationale: `${s.continued}/${s.entered} sessions advanced past ${s.label}.`,
      },
    });
  }
  return issues;
}
