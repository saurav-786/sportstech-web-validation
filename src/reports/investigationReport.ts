/**
 * investigationReport.ts — consolidated end-to-end incident investigation report.
 *
 * Produces the nine requested deliverables in one document (HTML + Markdown):
 *   1. Executive Summary
 *   2. QA End-to-End Report
 *   3. Revenue Risk Report
 *   4. Console / Network Error Report
 *   5. Mobile Compatibility Report
 *   6. RCA Hypothesis Report (maps evidence to each incident hypothesis)
 *   7. Recommended Fixes & Preventive Actions
 *
 * Pure rendering + a deterministic hypothesis evaluator over collected evidence.
 */
import {
  FUNNEL_ORDER,
  type DeploymentCorrelation,
  type JourneyResult,
  type MediaPageResult,
  type RevenueHealth,
  type ValidationIssue,
} from '../types.js';
import type { RcaResult } from '../ai/evidenceRca.js';

export type Verdict = 'confirmed' | 'suspected' | 'not-observed' | 'ruled-out';

export interface Hypothesis {
  id: string;
  question: string;
  verdict: Verdict;
  confidence: number;
  evidence: string[];
}

export interface InvestigationInput {
  incidentDate: string;
  health: RevenueHealth;
  journeys: JourneyResult[];
  mediaResults: MediaPageResult[];
  rca: RcaResult[];
  allIssues: ValidationIssue[];
}

const VERDICT_COLOUR: Record<Verdict, string> = {
  confirmed: '#b71c1c', suspected: '#e64a19', 'not-observed': '#607d8b', 'ruled-out': '#2e7d32',
};

function has(issues: ValidationIssue[], pred: (i: ValidationIssue) => boolean): ValidationIssue[] {
  return issues.filter(pred);
}
function moneySev(i: ValidationIssue): boolean { return i.severity === 'critical' || i.severity === 'high'; }

/** Deterministic hypothesis evaluation from collected evidence. */
export function evaluateHypotheses(input: InvestigationInput): Hypothesis[] {
  const { allIssues, journeys, health } = input;
  const hyp: Hypothesis[] = [];

  // Frontend?
  const fe = has(allIssues, (i) => i.area === 'jserror' || (i.failureClass === 'frontend' && moneySev(i)));
  hyp.push(verdict('frontend', 'Was the issue likely frontend (JS/render)?', fe,
    fe.some((i) => i.area === 'jserror' && moneySev(i)) ? 'confirmed' : fe.length ? 'suspected' : 'not-observed'));

  // Checkout/cart?
  const cc = has(allIssues, (i) => (i.funnelStage === 'cart' || i.funnelStage === 'checkout') && moneySev(i));
  hyp.push(verdict('checkout-cart', 'Was it checkout/cart related?', cc,
    cc.some((i) => i.area === 'journey' && i.severity === 'critical') ? 'confirmed' : cc.length ? 'suspected' : 'not-observed'));

  // Payment?
  const pay = has(allIssues, (i) => i.funnelStage === 'payment' && moneySev(i));
  hyp.push(verdict('payment', 'Was it payment related?', pay,
    pay.length ? (pay.some((i) => i.severity === 'critical') ? 'confirmed' : 'suspected') : 'not-observed'));

  // Bundle / cross-sell? (AOV)
  const bx = has(allIssues, (i) => /bundle|cross-sell|cross sell|accessory|add-?on|set price/i.test(i.summary));
  hyp.push(verdict('bundle', 'Was it bundle/cross-sell related (AOV)?', bx,
    bx.some((i) => /mismatch|no valid price/i.test(i.summary)) ? 'confirmed' : bx.length ? 'suspected' : 'not-observed'));

  // Mobile specific?
  const mobileDevices = journeys.filter((j) => /iphone|pixel|galaxy|android|samsung|mobile/i.test(j.device));
  const desktopDevices = journeys.filter((j) => /desktop|chrome|firefox|edge|safari/i.test(j.device) && !/iphone|pixel|galaxy|android/i.test(j.device));
  const worstMobile = Math.min(...mobileDevices.map((j) => FUNNEL_ORDER.indexOf(j.reachedStage)), Infinity);
  const bestDesktop = Math.max(...desktopDevices.map((j) => FUNNEL_ORDER.indexOf(j.reachedStage)), -Infinity);
  const mobileOnlyIssues = has(allIssues, (i) => !!i.device && /iphone|pixel|galaxy|android|samsung|mobile/i.test(i.device) && moneySev(i));
  const mobileSpecific = mobileDevices.length > 0 && desktopDevices.length > 0 && worstMobile < bestDesktop;
  hyp.push(verdict('mobile', 'Was it mobile specific?', mobileOnlyIssues,
    mobileSpecific ? 'confirmed' : mobileOnlyIssues.length ? 'suspected' : (mobileDevices.length ? 'not-observed' : 'not-observed'),
    mobileSpecific ? [`Mobile reached only "${FUNNEL_ORDER[worstMobile] ?? '—'}" while desktop reached "${FUNNEL_ORDER[bestDesktop] ?? '—'}".`] : []));

  // Deployment regression?
  const reg = health.deployments.filter((d) => d.verdict === 'regression-suspected');
  hyp.push({
    id: 'deployment',
    question: 'Was it deployment-regression related?',
    verdict: reg.length ? 'suspected' : (health.deployments.length ? 'not-observed' : 'not-observed'),
    confidence: reg.length ? Math.max(...reg.map((d) => d.confidence)) : 20,
    evidence: reg.length
      ? reg.map((d) => `Deploy ${d.deployment.id} (${d.deployment.timestamp}): business CR ${pct(d.conversionBefore)}→${pct(d.conversionAfter)} (${d.conversionDeltaPct ?? '?'}%), verified-data estimate ${eur(d.revenueLossEstimateEur)}. ${d.likelyRootCause ?? ''}`)
      : ['No conversion history around the deployment window — seed reports/history to enable correlation.'],
  });

  return hyp;
}

function verdict(id: string, question: string, evidence: ValidationIssue[], v: Verdict, extra: string[] = []): Hypothesis {
  const ev = [...extra, ...evidence.slice(0, 6).map((i) => `[${i.severity}] ${i.summary}${i.device ? ` (${i.device})` : ''}`)];
  const confidence = v === 'confirmed' ? 85 : v === 'suspected' ? 60 : v === 'ruled-out' ? 75 : 30;
  return { id, question, verdict: v, confidence, evidence: ev.length ? ev : ['No supporting evidence observed in this run.'] };
}

function pct(n?: number): string { return n === undefined ? '—' : `${(n * 100).toFixed(2)}%`; }
function eur(n?: number): string { return n === undefined ? '—' : `€${Math.round(n).toLocaleString()}`; }
function esc(s: string): string { return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c)); }

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------
export function buildInvestigationHtml(input: InvestigationInput): string {
  const { health, journeys, allIssues, rca, mediaResults } = input;
  const hyps = evaluateHypotheses(input);

  const sevCount = (s: string) => allIssues.filter((i) => i.severity === s).length;
  const consoleNet = allIssues.filter((i) => i.area === 'jserror');
  const mobileIssues = allIssues.filter((i) => i.device && /iphone|pixel|galaxy|android|samsung|mobile|tablet|ipad/i.test(i.device));

  const stepRows = journeys.map((j) => `<tr>
    <td>${j.device}/${j.browser}</td>
    <td><code>${j.reachedStage}</code></td>
    <td>${j.steps.filter((s) => s.ok).length}/${j.steps.length} ok</td>
    <td style="color:${j.issues.some((i) => i.severity === 'critical') ? '#b71c1c' : '#555'}">${j.issues.length} issue(s), ${j.jsErrors.length} JS err</td>
  </tr>`).join('');

  const hypRows = hyps.map((h) => `
    <div class="hyp">
      <div><span class="vbadge" style="background:${VERDICT_COLOUR[h.verdict]}">${h.verdict.toUpperCase()}</span>
        <strong>${esc(h.question)}</strong> <span class="muted">(${h.confidence}% conf.)</span></div>
      <ul>${h.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
    </div>`).join('');

  const riskRows = health.topRevenueRisks.map((i) => `<tr>
    <td><span class="pill" style="background:${VERDICT_COLOUR[i.revenueImpact?.priority === 'P0' ? 'confirmed' : 'suspected']}">${i.revenueImpact?.priority ?? ''}</span></td>
    <td>${i.funnelStage ?? '—'}</td><td>${esc(i.summary)}</td>
    <td style="text-align:right;font-weight:600">${i.revenueImpact?.estDailyRevenueEur !== undefined ? `${eur(i.revenueImpact.estDailyRevenueEur)}/day` : 'Unavailable'}</td>
    <td style="text-align:right">${i.revenueImpact?.confidence ?? '—'}%</td>
  </tr>`).join('') || emptyRow(5);

  const consoleRows = consoleNet.slice(0, 100).map((i) => `<tr>
    <td><span class="sev" style="background:${sevColour(i.severity)}">${i.severity}</span></td>
    <td>${i.funnelStage ?? '—'}</td><td>${i.device ?? '—'}</td><td style="font-size:.78rem">${esc(i.summary)}</td>
  </tr>`).join('') || emptyRow(4);

  const mobileRows = mobileIssues.slice(0, 100).map((i) => `<tr>
    <td>${i.device}</td><td><span class="sev" style="background:${sevColour(i.severity)}">${i.severity}</span></td>
    <td>${i.funnelStage ?? '—'}</td><td style="font-size:.78rem">${esc(i.summary)}</td>
  </tr>`).join('') || emptyRow(4);

  const fixes = recommendedFixes(hyps, allIssues);

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Sportstech Revenue Incident — Investigation Report</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f6fb;color:#1c2533;padding:28px;max-width:1100px;margin:0 auto}
  h1{font-size:1.7rem}h2{font-size:1.15rem;margin:30px 0 10px;color:#1565c0;border-bottom:2px solid #e0e6f0;padding-bottom:5px}
  h3{font-size:.95rem;margin:14px 0 6px}
  .meta{font-size:.82rem;color:#7a8aa0;margin-bottom:14px}
  .muted{color:#7a8aa0;font-weight:400;font-size:.85em}
  .card{background:#fff;border-radius:10px;padding:18px;margin-bottom:14px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
  .kpis{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px}
  .kpi{background:#fff;border-radius:9px;padding:12px 18px;min-width:120px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.07)}
  .kpi b{font-size:1.7rem;display:block}
  .kpi span{font-size:.68rem;color:#8a97ad;text-transform:uppercase}
  table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.07)}
  th{background:#1565c0;color:#fff;text-align:left;padding:8px 10px;font-size:.7rem;text-transform:uppercase}
  td{padding:8px 10px;font-size:.82rem;border-bottom:1px solid #eef1f6;vertical-align:top}
  .hyp{background:#fff;border-radius:8px;padding:12px 14px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  .hyp ul{margin:6px 0 0 18px;font-size:.82rem;color:#42506a}
  .vbadge,.pill,.sev{color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700}
  .sev{border-radius:3px}
  code{background:#eef1f6;padding:1px 6px;border-radius:4px;color:#1565c0}
  .banner{border-radius:10px;padding:16px;margin:14px 0;font-size:.95rem;line-height:1.5}
  ol{margin:6px 0 0 20px}ol li{font-size:.85rem;margin:5px 0}
  a{color:#1565c0}
  .actions{display:flex;gap:10px;margin:0 0 18px}
  .download{display:inline-block;background:#1565c0;color:#fff;padding:9px 14px;border-radius:7px;font-size:.82rem;font-weight:700;text-decoration:none}
  @media print{.no-print{display:none!important}body{background:#fff}.card,.kpi,.hyp{box-shadow:none;border:1px solid #dfe5ef}}
</style></head><body>

<h1>🔎 Sportstech.de — Revenue Incident Investigation</h1>
<p class="meta">Incident date ${input.incidentDate} · Report generated ${health.generatedAt} · Site ${esc(healthBase(health))}</p>
<div class="actions no-print"><a class="download" href="investigation-report.pdf" download>Download PDF report</a></div>

<h2>1. Executive Summary</h2>
<div class="banner" style="background:${health.revenueHealthScore >= 80 ? '#e6f4ea' : health.revenueHealthScore >= 60 ? '#fdf3e3' : '#fde8e8'}">
${execNarrative(input, hyps)}
</div>
<div class="kpis">
  <div class="kpi"><b style="color:${scoreC(health.revenueHealthScore)}">${health.revenueHealthScore}</b><span>Revenue Health</span></div>
  <div class="kpi"><b style="color:${scoreC(health.conversionHealthScore)}">${health.conversionHealthScore}</b><span>Conversion Health</span></div>
  <div class="kpi"><b style="color:${scoreC(health.checkoutSuccessPct)}">${health.checkoutSuccessPct}%</b><span>Checkout</span></div>
  <div class="kpi"><b style="color:${scoreC(health.paymentSuccessPct)}">${health.paymentSuccessPct}%</b><span>Payment</span></div>
  <div class="kpi"><b style="color:${scoreC(health.mobileHealthScore)}">${health.mobileHealthScore}</b><span>Mobile</span></div>
  <div class="kpi"><b style="color:#b71c1c">${sevCount('critical')}</b><span>Critical</span></div>
  <div class="kpi"><b style="color:#e64a19">${sevCount('high')}</b><span>High</span></div>
</div>

<h2>2. QA End-to-End Report</h2>
<p class="muted">Full journey across ${journeys.length} device/browser run(s): homepage → category → PLP → PDP → add-to-cart → cart → checkout → payment boundary.</p>
<div class="card"><table>
  <thead><tr><th>Device / Browser</th><th>Reached stage</th><th>Steps</th><th>Findings</th></tr></thead>
  <tbody>${stepRows || emptyRow(4)}</tbody>
</table></div>

<h2>3. Revenue Risk Report</h2>
<p class="muted">Top risks from the live automation run. ${esc(health.assumptions.disclaimer)}</p>
<div class="card"><table>
  <thead><tr><th>Pri</th><th>Stage</th><th>Observed risk</th><th style="text-align:right">Verified estimate</th><th style="text-align:right">Conf.</th></tr></thead>
  <tbody>${riskRows}</tbody>
</table></div>

<h2>4. Console / Network Error Report</h2>
<p class="muted">Captured client-side exceptions, console errors, failed requests (4xx/5xx) and CSP violations, mapped to funnel stage.</p>
<div class="card"><table>
  <thead><tr><th>Severity</th><th>Stage</th><th>Device</th><th>Error</th></tr></thead>
  <tbody>${consoleRows}</tbody>
</table></div>

<h2>5. Mobile Compatibility Report</h2>
<p class="muted">Mobile/tablet-scoped findings across the device matrix (iPhone/Safari, Android Chrome, tablet).</p>
<div class="card"><table>
  <thead><tr><th>Device</th><th>Severity</th><th>Stage</th><th>Finding</th></tr></thead>
  <tbody>${mobileRows}</tbody>
</table></div>
${mediaResults.length ? `<p class="muted">PDP media weight audited on mobile + desktop — see <a href="media-report.html">media-report.html</a> (${mediaResults.length} page-runs).</p>` : ''}

<h2>6. RCA Hypothesis Report</h2>
<p class="muted">Each incident hypothesis evaluated against evidence from this run.</p>
${hypRows}

<h2>7. AI Root Cause (per failing journey)</h2>
<div class="card">${rca.length ? rca.map((r) => `<div class="hyp"><div><span class="pill" style="background:${VERDICT_COLOUR[r.priority === 'P0' ? 'confirmed' : 'suspected']}">${r.priority}</span> <strong>${r.device}/${r.browser}</strong> — reached <code>${r.reachedStage}</code> · ${r.confidence}% ${r.aiGenerated ? 'AI' : 'heuristic'}</div><p style="font-size:.85rem;margin-top:5px"><strong>Cause:</strong> ${esc(r.rootCause)}<br/><strong>Fix:</strong> ${esc(r.recommendedFix)}</p></div>`).join('') : '<p class="muted">No failing journeys to analyze.</p>'}</div>

<h2>8. Recommended Fixes &amp; Preventive Actions</h2>
<div class="card">
  <h3>Immediate fixes</h3><ol>${fixes.immediate.map((f) => `<li>${esc(f)}</li>`).join('')}</ol>
  <h3>Preventive actions</h3><ol>${fixes.preventive.map((f) => `<li>${esc(f)}</li>`).join('')}</ol>
</div>

<p class="meta" style="margin-top:20px">Generated by the Revenue Protection Platform · boundary-safe (no orders placed) · device matrix: ${[...new Set(journeys.map((j) => j.device))].join(', ') || '—'}</p>
</body></html>`;
}

function healthBase(_h: RevenueHealth): string { return 'https://www.sportstech.de/'; }
function scoreC(n: number): string { return n >= 80 ? '#2e7d32' : n >= 60 ? '#f57c00' : '#b71c1c'; }
function sevColour(s: string): string { return ({ critical: '#b71c1c', high: '#e64a19', medium: '#f57c00', low: '#388e3c', info: '#0288d1' } as Record<string, string>)[s] ?? '#666'; }
function emptyRow(cols: number): string { return `<tr><td colspan="${cols}" style="text-align:center;color:#8a97ad;padding:18px">None observed in this run 🎉</td></tr>`; }

function execNarrative(input: InvestigationInput, hyps: Hypothesis[]): string {
  const confirmed = hyps.filter((h) => h.verdict === 'confirmed');
  const suspected = hyps.filter((h) => h.verdict === 'suspected');
  const lead = confirmed[0] ?? suspected[0];
  const reg = input.health.deployments.find((d) => d.verdict === 'regression-suspected');
  const parts: string[] = [];
  parts.push(`<strong>Revenue Health is ${input.health.revenueHealthScore}/100</strong> with ${input.allIssues.filter((i) => i.severity === 'critical').length} critical and ${input.allIssues.filter((i) => i.severity === 'high').length} high finding(s) across ${input.journeys.length} device run(s).`);
  if (lead) parts.push(`The strongest signal points to a <strong>${lead.id.replace('-', '/')}</strong> cause (${lead.verdict}, ${lead.confidence}% confidence).`);
  if (reg) parts.push(`A deployment-regression correlation was found around <strong>${reg.deployment.timestamp}</strong> (conversion ${pct(reg.conversionBefore)}→${pct(reg.conversionAfter)}, est. ${eur(reg.revenueLossEstimateEur)} loss).`);
  if (!confirmed.length && !suspected.length) parts.push('No revenue-blocking defect was reproduced in this run; see the hypothesis table for what was checked.');
  return parts.join(' ');
}

function recommendedFixes(hyps: Hypothesis[], issues: ValidationIssue[]): { immediate: string[]; preventive: string[] } {
  const immediate: string[] = [];
  const active = new Set(hyps.filter((h) => h.verdict === 'confirmed' || h.verdict === 'suspected').map((h) => h.id));
  if (active.has('checkout-cart')) immediate.push('Triage the failing cart/checkout step on the affected device(s); re-test add-to-cart → cart persistence → checkout entry after the fix.');
  if (active.has('payment')) immediate.push('Verify the payment provider/SDK loads on every device; check for a regression in the payment integration deployed on 11.06.');
  if (active.has('bundle')) immediate.push('Audit bundle/set pricing rules and cross-sell population — a bundle priced ≥ sum of parts or a missing cross-sell block directly suppresses AOV.');
  if (active.has('mobile')) immediate.push('Reproduce on the specific mobile profile that stalled earliest; mobile-only checkout breakage is the highest-leverage fix.');
  if (active.has('frontend')) immediate.push('Resolve the captured JS exceptions on money-path pages; an unhandled exception on cart/checkout halts conversion.');
  if (active.has('deployment')) immediate.push('Treat the 11.06 deployment as the prime suspect: diff checkout/payment/bundle changes in that release and prepare a rollback/hotfix.');
  if (!immediate.length) immediate.push('No revenue-blocking defect reproduced; widen the device matrix and add real GA4 conversion history to sharpen deployment correlation.');

  const preventive = [
    'Run this @revenue suite on a 6-hour schedule (revenue-protection.yml) so checkout/payment breakage is caught before customers report it.',
    'Connect real Shopware/GA business metrics so deployment correlation and monetary estimates are data-backed; otherwise retain automation-only risk scores.',
    'Add a deploy webhook to test-data/deployments.json so every release is auto-correlated against conversion the same hour.',
    'Gate production deploys on the smoke + @revenue journey passing on Desktop Chrome and Mobile Safari.',
    'Add bundle-price and cross-sell-presence assertions to the PDP suite so AOV regressions fail CI.',
    'Alert on any P0 revenue risk via the existing Slack webhook.',
  ];
  return { immediate, preventive };
}

// ---------------------------------------------------------------------------
// Markdown (portable for tickets / wiki)
// ---------------------------------------------------------------------------
export function buildInvestigationMarkdown(input: InvestigationInput): string {
  const { health, journeys, allIssues } = input;
  const hyps = evaluateHypotheses(input);
  const fixes = recommendedFixes(hyps, allIssues);
  const line = (s: string) => `${s}\n`;
  let md = '';
  md += line(`# Sportstech.de — Revenue Incident Investigation`);
  md += line(`Incident: ${input.incidentDate} · Generated: ${health.generatedAt}\n`);
  md += line(`## 1. Executive Summary`);
  md += line(`- Revenue Health: **${health.revenueHealthScore}/100**, Conversion Health: ${health.conversionHealthScore}/100`);
  md += line(`- Checkout ${health.checkoutSuccessPct}% · Cart ${health.cartSuccessPct}% · Payment ${health.paymentSuccessPct}% · Mobile ${health.mobileHealthScore}`);
  md += line(`- Critical: ${allIssues.filter((i) => i.severity === 'critical').length} · High: ${allIssues.filter((i) => i.severity === 'high').length}\n`);
  md += line(`## 6. RCA Hypotheses`);
  for (const h of hyps) {
    md += line(`### ${h.question} — **${h.verdict.toUpperCase()}** (${h.confidence}%)`);
    for (const e of h.evidence) md += line(`- ${e}`);
    md += line('');
  }
  md += line(`## 7. Recommended Fixes`);
  md += line(`**Immediate:**`);
  for (const f of fixes.immediate) md += line(`- ${f}`);
  md += line(`\n**Preventive:**`);
  for (const f of fixes.preventive) md += line(`- ${f}`);
  return md;
}
