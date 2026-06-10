import { appConfig } from '../config.js';
import type { ValidationIssue } from '../types.js';
import { classifyIssue, issueSignature } from './analyzer.js';
import { completeJson, parseJsonResponse } from './provider.js';

/**
 * Enrich issues with rootCause / suggestedFix / businessImpact.
 * Uses the pluggable AI provider (Anthropic or OpenAI); heuristic classification always applies.
 */
export async function enrichIssuesWithAi(issues: ValidationIssue[]): Promise<ValidationIssue[]> {
  const classified = issues.map((issue) => ({
    ...issue,
    failureClass: issue.failureClass ?? classifyIssue(issue),
    signature: issue.signature ?? issueSignature(issue)
  }));
  if (!appConfig.useAi || classified.length === 0) return classified;

  const sample = classified.slice(0, 30);
  const raw = await completeJson(
    'You are an expert QA architect. Return JSON with an "issues" array, same length and order as input. For each issue add rootCause, suggestedFix, and businessImpact (each under 30 words).',
    { issues: sample.map(({ area, severity, pageUrl, summary, evidence, failureClass }) => ({ area, severity, pageUrl, summary, evidence: evidence?.slice(0, 150), failureClass })) }
  );
  const parsed = parseJsonResponse<{ issues?: Partial<ValidationIssue>[] }>(raw);
  if (!parsed?.issues) return classified;

  return classified.map((issue, index) => ({
    ...issue,
    rootCause: parsed.issues?.[index]?.rootCause ?? issue.rootCause,
    suggestedFix: parsed.issues?.[index]?.suggestedFix ?? issue.suggestedFix,
    businessImpact: parsed.issues?.[index]?.businessImpact ?? issue.businessImpact
  }));
}
