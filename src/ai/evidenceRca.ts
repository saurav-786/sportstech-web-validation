/**
 * evidenceRca.ts — Phase 8: evidence-based AI Root Cause Analysis.
 *
 * Assembles a multi-signal evidence bundle per failed journey (failed steps,
 * classified JS errors, failed-request URLs, reached stage, device/browser) and
 * asks the configured LLM for a grounded root cause / impact / fix / priority.
 * REUSES src/ai/provider.ts and degrades to an evidence-grounded heuristic (no
 * generic text) when no API key is present — matching the platform's "AI
 * degrades gracefully" principle.
 */
import { completeJson, parseJsonResponse } from './provider.js';
import type { JourneyResult } from '../types.js';

export interface RcaResult {
  journey: string;
  device: string;
  browser: string;
  reachedStage: string;
  rootCause: string;
  impact: string;
  recommendedFix: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  confidence: number;
  evidence: string[];
  aiGenerated: boolean;
}

function buildEvidence(j: JourneyResult): string[] {
  const ev: string[] = [];
  const failed = j.steps.filter((s) => !s.ok);
  for (const s of failed) ev.push(`Step failed: "${s.name}" (stage ${s.stage})${s.detail ? ` — ${s.detail}` : ''}`);
  const moneyErrors = j.jsErrors.filter((e) => e.funnelStage === 'checkout' || e.funnelStage === 'payment' || e.funnelStage === 'cart' || e.funnelStage === 'add-to-cart');
  for (const e of moneyErrors.slice(0, 6)) ev.push(`${e.type} @ ${e.funnelStage ?? 'unknown'}: ${e.message}${e.count > 1 ? ` (×${e.count})` : ''}`);
  if (!ev.length && j.jsErrors.length) {
    for (const e of j.jsErrors.slice(0, 4)) ev.push(`${e.type}: ${e.message}`);
  }
  ev.push(`Reached stage: ${j.reachedStage}; completed: ${j.completed}`);
  return ev;
}

function heuristicRca(j: JourneyResult, evidence: string[]): RcaResult {
  const firstFail = j.steps.find((s) => !s.ok);
  const moneyError = j.jsErrors.find((e) => e.funnelStage === 'checkout' || e.funnelStage === 'payment');
  const stage = firstFail?.stage ?? j.reachedStage;
  const moneyStage = stage === 'checkout' || stage === 'payment' || stage === 'cart' || stage === 'add-to-cart';

  let rootCause: string;
  if (moneyError) rootCause = `A ${moneyError.type} on the ${moneyError.funnelStage} step ("${moneyError.message.slice(0, 120)}") prevented the journey from advancing.`;
  else if (firstFail) rootCause = `The "${firstFail.name}" step failed at the ${firstFail.stage} stage${firstFail.detail ? ` with: ${firstFail.detail.slice(0, 120)}` : ' (element not found / not actionable)'}.`;
  else rootCause = `Journey stalled at ${j.reachedStage} without an explicit step failure — likely a missing downstream control or slow render.`;

  return {
    journey: j.name,
    device: j.device,
    browser: j.browser,
    reachedStage: j.reachedStage,
    rootCause,
    impact: moneyStage
      ? `Blocks the ${stage} step on ${j.device}/${j.browser}, halting purchases for affected sessions.`
      : `Degrades the ${stage} experience on ${j.device}/${j.browser}; downstream conversion at risk.`,
    recommendedFix: firstFail?.name.includes('Add to Cart')
      ? 'Verify the add-to-cart button selector, enabled state, and post-click cart confirmation on this device.'
      : moneyError
        ? 'Fix the failing script/request on the money step; add error handling so the UI degrades safely.'
        : 'Reproduce on the listed device, inspect the failing selector/console, and restore the broken control.',
    priority: moneyStage ? 'P0' : firstFail ? 'P1' : 'P2',
    confidence: moneyError ? 80 : firstFail ? 70 : 55,
    evidence,
    aiGenerated: false,
  };
}

const SYSTEM = `You are a senior SRE doing root-cause analysis on an ecommerce purchase journey.
You are given concrete evidence (failed steps, classified JS errors, failed requests, reached funnel stage, device).
Return JSON: { "rootCause": string, "impact": string, "recommendedFix": string, "priority": "P0"|"P1"|"P2"|"P3", "confidence": number }.
Ground every claim in the supplied evidence. Do NOT invent causes not supported by the evidence. Be specific.`;

export async function analyzeJourney(j: JourneyResult): Promise<RcaResult | null> {
  // Only analyze journeys that actually failed or carry money-stage errors.
  const hasFailure = j.steps.some((s) => !s.ok) || !j.completed || j.jsErrors.length > 0;
  if (!hasFailure) return null;

  const evidence = buildEvidence(j);
  const heuristic = heuristicRca(j, evidence);

  const raw = await completeJson(SYSTEM, {
    device: j.device, browser: j.browser, reachedStage: j.reachedStage, completed: j.completed, evidence,
  });
  const ai = parseJsonResponse<Partial<RcaResult>>(raw);
  if (!ai || !ai.rootCause) return heuristic;

  return {
    ...heuristic,
    rootCause: ai.rootCause,
    impact: ai.impact ?? heuristic.impact,
    recommendedFix: ai.recommendedFix ?? heuristic.recommendedFix,
    priority: ai.priority ?? heuristic.priority,
    confidence: typeof ai.confidence === 'number' ? ai.confidence : heuristic.confidence,
    aiGenerated: true,
  };
}

export async function analyzeJourneys(journeys: JourneyResult[]): Promise<RcaResult[]> {
  const out: RcaResult[] = [];
  for (const j of journeys) {
    const r = await analyzeJourney(j).catch(() => null);
    if (r) out.push(r);
  }
  return out;
}
