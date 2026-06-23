/**
 * revenueDashboard.ts — Phase 9: self-contained executive Revenue dashboard.
 * Single HTML file (inline CSS/SVG, no external deps) matching the platform's
 * shareable-report philosophy. Renders all requested widgets:
 *   Revenue Health, Conversion Health, Checkout/Cart/Payment success, Mobile,
 *   Performance, Top Failures, Top Revenue Risks, Critical Incidents,
 *   Recent Deployments, Conversion Funnel + AI Root Cause.
 */
import type { RevenueHealth, ValidationIssue } from '../types.js';
import type { RcaResult } from '../ai/evidenceRca.js';
import { renderFunnelSvg } from '../conversion/funnelChart.js';

function scoreColour(n: number): string {
  return n >= 90 ? '#2e7d32' : n >= 70 ? '#f57c00' : '#d32f2f';
}
function eur(n?: number): string {
  return n === undefined ? '—' : `€${Math.round(n).toLocaleString('en-US')}`;
}
function gauge(label: string, value: number, suffix = '', inverse = false): string {
  const colour = inverse
    ? (value <= 10 ? '#2e7d32' : value <= 30 ? '#f57c00' : '#d32f2f')
    : scoreColour(value);
  return `<div class="kpi">
    <div class="kpi-num" style="color:${colour}">${value}${suffix}</div>
    <div class="kpi-lbl">${label}</div>
  </div>`;
}
function optionalGauge(label: string, value?: number): string {
  return value === undefined
    ? `<div class="kpi"><div class="kpi-num" style="color:#7e8aad">N/A</div><div class="kpi-lbl">${label}</div></div>`
    : gauge(label, value);
}
function priBadge(p?: string): string {
  const c: Record<string, string> = { P0: '#b71c1c', P1: '#e64a19', P2: '#f57c00', P3: '#558b2f' };
  return p ? `<span class="pill" style="background:${c[p] ?? '#666'}">${p}</span>` : '';
}

function riskRows(risks: ValidationIssue[]): string {
  if (!risks.length) return `<tr><td colspan="6" style="text-align:center;color:#888;padding:18px">No quantified revenue risks 🎉</td></tr>`;
  return risks.map((i) => {
    const ri = i.revenueImpact;
    return `<tr>
      <td>${priBadge(ri?.priority)}</td>
      <td>${ri?.funnelStage ?? '—'}</td>
      <td>${i.summary}</td>
      <td style="text-align:right;font-weight:600">${ri?.estDailyRevenueEur !== undefined ? `${eur(ri.estDailyRevenueEur)}/day` : 'Unavailable'}</td>
      <td style="text-align:right">${ri?.usersImpactedPct ?? '—'}%</td>
      <td style="text-align:right">${ri?.confidence ?? '—'}%</td>
    </tr>`;
  }).join('');
}

function defectRows(issues: ValidationIssue[]): string {
  if (!issues.length) return `<tr><td colspan="5" style="text-align:center;color:#888;padding:18px">No technical defects recorded.</td></tr>`;
  return issues.map((i) => `<tr>
    <td><span class="pill" style="background:${i.severity === 'critical' ? '#b71c1c' : i.severity === 'high' ? '#e64a19' : '#f57c00'}">${i.severity}</span></td>
    <td>${escapeHtml(i.failureCategory ?? 'Real Website Issue')}</td>
    <td>${escapeHtml(i.area)}</td>
    <td>${escapeHtml(i.summary)}</td>
    <td>${i.confidence ?? '—'}%</td>
  </tr>`).join('');
}

/** Per-device/browser coverage for the revenue journey — shows exactly which
 *  device+browser combinations were exercised and how far each one got. */
function deviceCoverageRows(h: RevenueHealth): string {
  if (!h.journeys.length) return `<tr><td colspan="5" style="text-align:center;color:#888;padding:18px">No revenue journeys recorded for this run.</td></tr>`;
  return [...h.journeys]
    .sort((a, b) => a.device.localeCompare(b.device) || a.browser.localeCompare(b.browser))
    .map((j) => {
      const isMobile = /iphone|pixel|galaxy|android|samsung|ipad|tablet|mobile/i.test(j.device);
      const stepsOk = j.steps.filter((s) => s.ok).length;
      const colour = j.completed ? '#2e7d32' : '#d32f2f';
      return `<tr>
        <td>${escapeHtml(j.device)} <span class="pill" style="background:${isMobile ? '#5e35b1' : '#37474f'}">${isMobile ? 'mobile' : 'desktop'}</span></td>
        <td>${escapeHtml(j.browser)}</td>
        <td><code>${escapeHtml(j.reachedStage)}</code></td>
        <td style="text-align:right">${stepsOk}/${j.steps.length}</td>
        <td style="color:${colour};font-weight:600">${j.completed ? 'Completed' : `Blocked at ${escapeHtml(j.reachedStage)}`}</td>
      </tr>`;
    }).join('');
}

function deploymentRows(h: RevenueHealth): string {
  if (!h.deployments.length) return `<tr><td colspan="5" style="text-align:center;color:#888;padding:18px">No deployment correlation data (add test-data/deployments.json + conversion history).</td></tr>`;
  return h.deployments.map((d) => {
    const colour = d.verdict === 'regression-suspected' ? '#d32f2f' : d.verdict === 'improvement' ? '#2e7d32' : '#666';
    return `<tr>
      <td>${new Date(d.deployment.timestamp).toLocaleString()}</td>
      <td>${d.deployment.ref?.slice(0, 8) ?? d.deployment.id}${d.deployment.description ? ` — ${d.deployment.description}` : ''}</td>
      <td style="color:${colour};font-weight:600">${d.verdict}${d.conversionDeltaPct !== undefined ? ` (${d.conversionDeltaPct}%)` : ''}</td>
      <td style="text-align:right">${eur(d.revenueLossEstimateEur)}</td>
      <td style="text-align:right">${d.confidence}%</td>
    </tr>`;
  }).join('');
}

function rcaCards(rca: RcaResult[]): string {
  if (!rca.length) return `<p class="muted">No failing journeys to analyze.</p>`;
  return rca.map((r) => `
    <div class="rca">
      <div class="rca-head">${priBadge(r.priority)} <strong>${r.journey}</strong> · ${r.device}/${r.browser} · reached <code>${r.reachedStage}</code> · ${r.confidence}% confidence ${r.aiGenerated ? '<span class="ai">AI</span>' : '<span class="heur">heuristic</span>'}</div>
      <div class="rca-body">
        <p><strong>Root cause:</strong> ${r.rootCause}</p>
        <p><strong>Impact:</strong> ${r.impact}</p>
        <p><strong>Recommended fix:</strong> ${r.recommendedFix}</p>
        <details><summary>Evidence (${r.evidence.length})</summary><ul>${r.evidence.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul></details>
      </div>
    </div>`).join('');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));
}

export function buildRevenueDashboardHtml(h: RevenueHealth, rca: RcaResult[]): string {
  const funnel = h.funnel;
  const a = h.assumptions;
  const baselineRevenue = a.connected && a.dailySessions !== undefined && a.baselineConversionRate !== undefined && a.averageOrderValueEur !== undefined
    ? Math.round(a.dailySessions * a.baselineConversionRate * a.averageOrderValueEur)
    : undefined;
  const totalRiskEur = a.connected
    ? h.topRevenueRisks.reduce((s, i) => s + (i.revenueImpact?.estDailyRevenueEur ?? 0), 0)
    : undefined;
  const topFailures = h.journeys
    .flatMap((j) => j.steps.filter((s) => !s.ok).map((s) => ({ ...s, device: j.device, browser: j.browser })))
    .slice(0, 12);

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Revenue Protection Dashboard</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1525;color:#e7ecf5;padding:24px}
  h1{font-size:1.6rem}h2{font-size:1.05rem;margin:26px 0 10px;color:#aab6d6}
  .meta{font-size:.8rem;color:#7e8aad;margin-bottom:18px}
  .muted{color:#7e8aad;font-size:.85rem}
  .kpis{display:flex;flex-wrap:wrap;gap:12px}
  .kpi{background:#182238;border-radius:10px;padding:16px 22px;min-width:150px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.4)}
  .kpi-num{font-size:2.1rem;font-weight:800}
  .kpi-lbl{font-size:.7rem;color:#8c99bd;text-transform:uppercase;letter-spacing:.5px;margin-top:4px}
  .card{background:#182238;border-radius:10px;padding:18px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.4)}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;padding:9px 10px;font-size:.72rem;text-transform:uppercase;color:#8c99bd;border-bottom:1px solid #2a3550}
  td{padding:9px 10px;font-size:.82rem;border-bottom:1px solid #222c44;vertical-align:top}
  .pill{color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700}
  .banner{border-radius:10px;padding:16px 18px;margin-bottom:18px;font-size:.95rem}
  code{background:#0d1322;padding:1px 5px;border-radius:4px;color:#9fd0ff}
  .rca{background:#101a2e;border-left:3px solid #e64a19;border-radius:8px;padding:12px 14px;margin-bottom:10px}
  .rca-head{font-size:.82rem;color:#cdd6ee;margin-bottom:6px}
  .rca-body p{font-size:.85rem;margin:4px 0;line-height:1.45}
  .ai{background:#1565c0;color:#fff;padding:1px 6px;border-radius:8px;font-size:10px}
  .heur{background:#455a64;color:#fff;padding:1px 6px;border-radius:8px;font-size:10px}
  a{color:#9fd0ff}
  .actions{display:flex;gap:10px;margin:0 0 18px}
  .download{display:inline-block;background:#1565c0;color:#fff;padding:9px 14px;border-radius:7px;font-size:.82rem;font-weight:700;text-decoration:none}
  @media print{
    .no-print{display:none!important}
    body{background:#fff;color:#1c2533}
    .card,.kpi,.rca{background:#fff;color:#1c2533;box-shadow:none;border:1px solid #dfe5ef}
    .banner{background:#f5f7fb!important;color:#1c2533;border:1px solid #dfe5ef}
    h2,.muted,.meta,.kpi-lbl,.rca-head{color:#5d6b82}
    .funnel-label{fill:#333!important}.funnel-metric{fill:#555!important}
  }
  details summary{cursor:pointer;color:#9fd0ff;font-size:.8rem;margin-top:4px}
  details ul{margin:6px 0 0 18px;font-size:.78rem;color:#b9c4e2}
</style></head><body>
<h1>🛡️ Revenue Protection Dashboard</h1>
<p class="meta">Run ${escapeHtml(h.runId)} · ${h.generatedAt} · ${escapeHtml(h.baseUrl)} · ${h.pagesTested}/${h.pagesDiscovered || '—'} pages tested/discovered · browsers: ${h.browsers.join(', ') || '—'} · devices: ${h.devices.join(', ') || '—'}</p>
${h.tests ? `<p class="meta">Tests: ${h.tests.passed} passed · ${h.tests.failed} failed · ${h.tests.flaky} flaky · ${h.tests.skipped} skipped · ${h.tests.total} total</p>` : ''}
<div class="actions no-print"><a class="download" href="revenue-report.pdf" download>Download PDF report</a></div>

<div class="banner" style="background:${h.revenueHealthScore >= 90 ? '#14361f' : h.revenueHealthScore >= 70 ? '#3a2e12' : '#3a1414'}">
  <strong>Live automation revenue health ${h.revenueHealthScore}/100; risk ${h.revenueRiskScore}/100.</strong>
  ${h.criticalIncidents.length} critical incident(s).
  ${totalRiskEur !== undefined ? `Verified-data modeled exposure ${eur(totalRiskEur)}/day.` : escapeHtml(a.disclaimer)}
</div>

<div class="kpis">
  ${gauge('Website Health', h.websiteHealthScore)}
  ${gauge('Revenue Health', h.revenueHealthScore)}
  ${gauge('Revenue Risk', h.revenueRiskScore, '', true)}
  ${gauge('Conversion Health', h.conversionHealthScore)}
  ${gauge('Add to Cart', h.addToCartSuccessPct, '%')}
  ${gauge('Checkout Success', h.checkoutSuccessPct, '%')}
  ${gauge('Cart Success', h.cartSuccessPct, '%')}
  ${gauge('Payment Page Load', h.paymentSuccessPct, '%')}
  ${gauge('PDP Health', h.pdpHealthScore, '%')}
  ${gauge('Mobile Health', h.mobileHealthScore)}
  ${gauge('JS Error Health', h.jsErrorRiskScore)}
  ${gauge('Network/API Health', h.networkRiskScore)}
  ${optionalGauge('Performance', h.performanceHealthScore)}
  ${optionalGauge('Accessibility', h.accessibilityHealthScore)}
</div>

<h2>Devices &amp; Browsers Tested (Revenue Journey) · ${h.journeys.length} run(s) across ${h.devices.length} device(s)</h2>
<div class="card"><table>
  <thead><tr><th>Device</th><th>Browser</th><th>Reached stage</th><th style="text-align:right">Steps passed</th><th>Result</th></tr></thead>
  <tbody>${deviceCoverageRows(h)}</tbody>
</table>
  <p class="muted" style="margin-top:8px">Each row is one purchase-journey run. Set <code>REVENUE_MATRIX=1</code> to exercise the full mobile + desktop device matrix; <code>REVENUE_MATRIX=0</code> runs the active browser projects only.</p>
</div>

<h2>Observed Automation Funnel · journey completion ${(funnel.overallConversionRate * 100).toFixed(2)}%</h2>
<div class="card">${renderFunnelSvg(funnel, 'dark')}
  ${funnel.biggestDropStage ? `<p class="muted" style="margin-top:8px">Biggest drop-off: <strong style="color:#ff8a65">${funnel.biggestDropStage}</strong></p>` : ''}
  <p class="muted" style="margin-top:8px">These percentages are success rates across this automation run, not the website's business conversion rate.</p>
</div>

<h2>Top 10 Live Revenue Risks</h2>
<div class="card"><table>
  <thead><tr><th>Pri</th><th>Stage</th><th>Observed issue</th><th style="text-align:right">Verified estimate</th><th style="text-align:right">Test coverage</th><th style="text-align:right">Conf.</th></tr></thead>
  <tbody>${riskRows(h.topRevenueRisks)}</tbody>
</table></div>

<h2>Top 10 Technical Defects</h2>
<div class="card"><table>
  <thead><tr><th>Severity</th><th>Classification</th><th>Area</th><th>Evidence-based finding</th><th>Conf.</th></tr></thead>
  <tbody>${defectRows(h.topTechnicalDefects)}</tbody>
</table></div>

<h2>Business Data Status</h2>
<div class="card">
  <p><strong>${escapeHtml(a.disclaimer)}</strong></p>
  ${a.connected ? `<p class="muted">Source: ${escapeHtml(a.sourceLabel ?? a.source)} · AOV ${eur(a.averageOrderValueEur)} · ${a.dailySessions?.toLocaleString()} sessions/day · actual CR ${((a.baselineConversionRate ?? 0) * 100).toFixed(2)}% · baseline revenue ${eur(baselineRevenue)}/day.</p>` : '<p class="muted">No AOV, sessions, CR, baseline revenue, or euro loss is fabricated. Connect a complete API/JSON/environment dataset to enable estimates.</p>'}
</div>

<h2>Top Failures</h2>
<div class="card"><table>
  <thead><tr><th>Step</th><th>Stage</th><th>Device / Browser</th><th>Evidence</th></tr></thead>
  <tbody>${topFailures.length ? topFailures.map((f) => `<tr><td>${escapeHtml(f.name)}</td><td>${f.stage}</td><td>${f.device} / ${f.browser}</td><td>${f.screenshot ? `<a href="${escapeHtml(f.screenshot.replace(/^reports\//, ''))}">Screenshot</a>` : '—'}</td></tr>`).join('') : `<tr><td colspan="4" style="text-align:center;color:#888;padding:18px">No failing journey steps.</td></tr>`}</tbody>
</table></div>

<h2>Recent Deployments &amp; Regression Correlation</h2>
<div class="card"><table>
  <thead><tr><th>When</th><th>Deployment</th><th>Verdict</th><th style="text-align:right">Est. loss</th><th style="text-align:right">Conf.</th></tr></thead>
  <tbody>${deploymentRows(h)}</tbody>
</table></div>

<h2>AI Root Cause Analysis</h2>
<div class="card">${rcaCards(rca)}</div>

<p class="meta" style="margin-top:18px">Evidence: <a href="playwright-report/index.html">Playwright report, traces, screenshots and videos</a> · journeys: ${h.journeys.map((j) => j.device).join(', ') || '—'}</p>
</body></html>`;
}
