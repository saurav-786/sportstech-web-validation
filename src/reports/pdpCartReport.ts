/**
 * pdpCartReport.ts — Cross-browser / cross-device "Add to Cart → Payment" report.
 *
 * Peer report to the Revenue + PDP-Discovery dashboards (single self-contained
 * HTML, inline CSS), rendered to PDF by the shared renderer (src/reports/pdf.ts).
 * Headlines exactly what the run found: for which PDP add-to-cart (or the path to
 * the payment page) failed, and on which browser / device.
 *
 * Pure (no I/O) — the aggregator CLI writes the file.
 */
import type { FunnelStage } from '../types.js';

export type FormFactor = 'desktop' | 'mobile' | 'tablet';

/** One PDP exercised on one device/browser. */
export interface PdpCartResult {
  url: string;
  category?: string;
  productName?: string;
  device: string;          // device profile id, e.g. "ios-safari-iphone"
  browser: string;         // engine: "chromium" | "webkit"
  formFactor: FormFactor;
  reachedStage: FunnelStage;
  addedToCart: boolean;
  reachedCart: boolean;
  reachedCheckout: boolean;
  reachedPayment: boolean;
  failedStep?: string;     // first failing journey step
  error?: string;
  durationMs: number;
  screenshot?: string;     // relative to reports/
}

export interface PdpCartDeviceSummary {
  device: string;
  browser: string;
  formFactor: FormFactor;
  tested: number;
  addToCartOk: number;
  addToCartFailed: number;
  reachedPayment: number;
}

export interface PdpCartReport {
  generatedAt: string;
  baseUrl: string;
  paymentMode: string;
  totalProducts: number;       // unique PDP URLs exercised
  totalRuns: number;           // url × device combinations
  devices: PdpCartDeviceSummary[];
  results: PdpCartResult[];
  addToCartFailures: PdpCartResult[];
  reachedCartNotPayment: PdpCartResult[];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
}

function pct(n: number, d: number): string {
  return d ? `${Math.round((n / d) * 100)}%` : '—';
}

function gauge(label: string, value: number | string, colour = '#9fd0ff'): string {
  return `<div class="kpi"><div class="kpi-num" style="color:${colour}">${value}</div><div class="kpi-lbl">${label}</div></div>`;
}

function deviceRows(r: PdpCartReport): string {
  if (!r.devices.length) return `<tr><td colspan="7" style="text-align:center;color:#888;padding:18px">No device runs recorded.</td></tr>`;
  return r.devices.map((d) => {
    const okColour = d.addToCartFailed === 0 ? '#2e7d32' : d.addToCartOk === 0 ? '#d32f2f' : '#f57c00';
    return `<tr>
      <td><strong>${escapeHtml(d.device)}</strong></td>
      <td>${escapeHtml(d.browser)}</td>
      <td>${d.formFactor}</td>
      <td style="text-align:right">${d.tested}</td>
      <td style="text-align:right;color:#2e7d32">${d.addToCartOk}</td>
      <td style="text-align:right;color:${d.addToCartFailed ? '#d32f2f' : '#2e7d32'};font-weight:700">${d.addToCartFailed}</td>
      <td style="text-align:right;color:${okColour}">${d.reachedPayment} (${pct(d.reachedPayment, d.tested)})</td>
    </tr>`;
  }).join('');
}

function failRows(rows: PdpCartResult[], emptyMsg: string): string {
  if (!rows.length) return `<tr><td colspan="6" style="text-align:center;color:#2e7d32;padding:18px">${emptyMsg}</td></tr>`;
  return rows.map((f) => `<tr>
    <td>${escapeHtml(f.category ?? '—')}</td>
    <td><a href="${escapeHtml(f.url)}">${escapeHtml(f.productName || f.url)}</a></td>
    <td><strong>${escapeHtml(f.device)}</strong></td>
    <td>${escapeHtml(f.browser)} · ${f.formFactor}</td>
    <td><code>${escapeHtml(f.reachedStage)}</code></td>
    <td>${escapeHtml(f.failedStep ?? f.error ?? '—')}</td>
  </tr>`).join('');
}

export function buildPdpCartReportHtml(r: PdpCartReport): string {
  const totalAtcOk = r.results.filter((x) => x.addedToCart).length;
  const totalPayment = r.results.filter((x) => x.reachedPayment).length;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Add to Cart → Payment Report</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1525;color:#e7ecf5;padding:24px}
  h1{font-size:1.6rem}h2{font-size:1.05rem;margin:26px 0 10px;color:#aab6d6}
  .meta{font-size:.8rem;color:#7e8aad;margin-bottom:18px}
  .muted{color:#7e8aad}
  .kpis{display:flex;flex-wrap:wrap;gap:12px}
  .kpi{background:#182238;border-radius:10px;padding:16px 22px;min-width:150px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.4)}
  .kpi-num{font-size:2.1rem;font-weight:800}
  .kpi-lbl{font-size:.7rem;color:#8c99bd;text-transform:uppercase;letter-spacing:.5px;margin-top:4px}
  .card{background:#182238;border-radius:10px;padding:18px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.4)}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;padding:9px 10px;font-size:.72rem;text-transform:uppercase;color:#8c99bd;border-bottom:1px solid #2a3550}
  td{padding:9px 10px;font-size:.82rem;border-bottom:1px solid #222c44;vertical-align:top}
  a{color:#9fd0ff}code{background:#0d1322;padding:1px 5px;border-radius:4px;color:#9fd0ff}
  .banner{border-radius:10px;padding:14px 18px;margin-bottom:18px;font-size:.92rem;background:#1b2742;border:1px solid #2a3550}
  @media print{
    body{background:#fff;color:#1c2533}
    .card,.kpi{background:#fff;color:#1c2533;box-shadow:none;border:1px solid #dfe5ef}
    .banner{background:#f5f7fb;border:1px solid #dfe5ef}
    h2,.muted,.meta,.kpi-lbl{color:#5d6b82}
  }
</style></head><body>
<h1>🛒 Add to Cart → Payment Report</h1>
<p class="meta">${r.generatedAt} · ${escapeHtml(r.baseUrl)} · ${r.totalProducts} product(s) × ${r.devices.length} device profile(s) = ${r.totalRuns} runs · payment mode: <code>${escapeHtml(r.paymentMode)}</code> (boundary = no real order placed)</p>

<div class="banner">Each product was added to cart and driven through guest checkout to the <strong>payment page</strong> on every browser/device. The tables below list exactly which PDP failed and on which browser/device.</div>

<div class="kpis">
  ${gauge('Products Tested', r.totalProducts)}
  ${gauge('Device Profiles', r.devices.length)}
  ${gauge('Total Runs', r.totalRuns)}
  ${gauge('Add-to-Cart OK', `${pct(totalAtcOk, r.totalRuns)}`, totalAtcOk === r.totalRuns ? '#2e7d32' : '#f57c00')}
  ${gauge('Add-to-Cart Failures', r.addToCartFailures.length, r.addToCartFailures.length ? '#d32f2f' : '#2e7d32')}
  ${gauge('Reached Payment', `${pct(totalPayment, r.totalRuns)}`, '#9fd0ff')}
</div>

<h2>Coverage by Browser / Device</h2>
<div class="card"><table>
  <thead><tr><th>Device profile</th><th>Engine</th><th>Form factor</th><th style="text-align:right">Tested</th><th style="text-align:right">ATC ok</th><th style="text-align:right">ATC failed</th><th style="text-align:right">Reached payment</th></tr></thead>
  <tbody>${deviceRows(r)}</tbody>
</table></div>

<h2>❌ Add-to-Cart Failures (PDP × browser/device)</h2>
<div class="card"><table>
  <thead><tr><th>Category</th><th>Product (PDP)</th><th>Device</th><th>Browser / form factor</th><th>Reached stage</th><th>Failed step / error</th></tr></thead>
  <tbody>${failRows(r.addToCartFailures, 'No add-to-cart failures — every PDP added to cart on every browser/device. 🎉')}</tbody>
</table></div>

<h2>⚠️ Added to Cart but Did NOT Reach Payment</h2>
<div class="card"><table>
  <thead><tr><th>Category</th><th>Product (PDP)</th><th>Device</th><th>Browser / form factor</th><th>Reached stage</th><th>Failed step / error</th></tr></thead>
  <tbody>${failRows(r.reachedCartNotPayment, 'Every cart that was created also reached the payment page. 🎉')}</tbody>
</table>
  <p class="muted" style="margin-top:8px;font-size:.78rem">Boundary-safe: the flow reaches the payment page and verifies payment options render, then stops — it never clicks "Zahlungspflichtig bestellen", so no real order is placed.</p>
</div>

<p class="meta" style="margin-top:18px">Artifacts: <code>reports/pdp-cart-report.json</code> · <code>reports/pdp-cart-report.csv</code></p>
</body></html>`;
}
