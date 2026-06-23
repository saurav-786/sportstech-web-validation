/**
 * pdpCartFastReport.ts — dashboard for the fast @pdp-cart-fast add-to-cart suite.
 *
 * Pure (no I/O): turns the summary written by tests/pdp-cart/summaryReporter.ts
 * into a single self-contained HTML dashboard (inline CSS), which the shared
 * renderer (src/reports/pdf.ts) exports to PDF. Scope is add-to-cart only, so the
 * KPIs/tables headline exactly that — for which PDP add-to-cart failed, on which
 * device, and why.
 */

export interface PdpCartFastResultRow {
  device: string;
  url: string;
  status: string; // 'passed' | 'failed' | 'timedOut' | 'interrupted' | 'skipped'
  durationMs: number;
  retries?: number;
  reason?: string;
}

export interface PdpCartFastSummary {
  generatedAt: string;
  totalUrls: number;
  deviceProfiles: number;
  totalChecks: number;
  passed: number;
  failed: number;
  skipped: number;
  totalMs: number;
  results: PdpCartFastResultRow[];
  failures: Array<{ device: string; url: string; reason?: string }>;
}

interface DeviceSummary {
  device: string;
  tested: number;
  passed: number;
  failed: number;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
}

function pct(n: number, d: number): string {
  return d ? `${Math.round((n / d) * 100)}%` : '—';
}

function slug(url: string): string {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).pop() ?? url;
  } catch {
    return url;
  }
}

function gauge(label: string, value: number | string, colour = '#9fd0ff'): string {
  return `<div class="kpi"><div class="kpi-num" style="color:${colour}">${value}</div><div class="kpi-lbl">${label}</div></div>`;
}

function byDevice(results: PdpCartFastResultRow[]): DeviceSummary[] {
  const map = new Map<string, DeviceSummary>();
  for (const r of results) {
    const s = map.get(r.device) ?? { device: r.device, tested: 0, passed: 0, failed: 0 };
    s.tested += 1;
    if (r.status === 'passed') s.passed += 1;
    else if (r.status !== 'skipped') s.failed += 1;
    map.set(r.device, s);
  }
  return [...map.values()].sort((a, b) => a.device.localeCompare(b.device));
}

function deviceRows(devices: DeviceSummary[]): string {
  if (!devices.length) return `<tr><td colspan="5" style="text-align:center;color:#888;padding:18px">No device runs recorded.</td></tr>`;
  return devices
    .map((d) => {
      const colour = d.failed === 0 ? '#2e7d32' : d.passed === 0 ? '#d32f2f' : '#f57c00';
      return `<tr>
      <td><strong>${escapeHtml(d.device)}</strong></td>
      <td style="text-align:right">${d.tested}</td>
      <td style="text-align:right;color:#2e7d32">${d.passed}</td>
      <td style="text-align:right;color:${d.failed ? '#d32f2f' : '#2e7d32'};font-weight:700">${d.failed}</td>
      <td style="text-align:right;color:${colour}">${pct(d.passed, d.tested)}</td>
    </tr>`;
    })
    .join('');
}

function failRows(rows: Array<{ device: string; url: string; reason?: string }>): string {
  if (!rows.length) return `<tr><td colspan="3" style="text-align:center;color:#2e7d32;padding:18px">No add-to-cart failures — every PDP added to cart on every device profile. 🎉</td></tr>`;
  return rows
    .slice()
    .sort((a, b) => a.device.localeCompare(b.device) || a.url.localeCompare(b.url))
    .map(
      (f) => `<tr>
      <td><a href="${escapeHtml(f.url)}">${escapeHtml(slug(f.url))}</a><div class="muted" style="font-size:.7rem">${escapeHtml(f.url)}</div></td>
      <td><strong>${escapeHtml(f.device)}</strong></td>
      <td>${escapeHtml(f.reason ?? '—')}</td>
    </tr>`,
    )
    .join('');
}

function secs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function slowestRows(results: PdpCartFastResultRow[]): string {
  const rows = results.slice().sort((a, b) => b.durationMs - a.durationMs).slice(0, 10);
  if (!rows.length) return `<tr><td colspan="3" style="text-align:center;color:#888;padding:18px">No timing data.</td></tr>`;
  return rows
    .map(
      (r) => `<tr>
      <td style="text-align:right;font-weight:700;color:${r.durationMs > 30000 ? '#d32f2f' : r.durationMs > 15000 ? '#f57c00' : '#9fd0ff'}">${secs(r.durationMs)}</td>
      <td><strong>${escapeHtml(r.device)}</strong></td>
      <td><a href="${escapeHtml(r.url)}">${escapeHtml(slug(r.url))}</a></td>
    </tr>`,
    )
    .join('');
}

function retriedRows(results: PdpCartFastResultRow[]): string {
  const rows = results.filter((r) => (r.retries ?? 0) > 0).sort((a, b) => (b.retries ?? 0) - (a.retries ?? 0));
  if (!rows.length) return `<tr><td colspan="4" style="text-align:center;color:#2e7d32;padding:18px">No PDP needed a retry. 🎉</td></tr>`;
  return rows
    .map(
      (r) => `<tr>
      <td style="text-align:right;font-weight:700;color:#f57c00">${r.retries}×</td>
      <td><strong>${escapeHtml(r.device)}</strong></td>
      <td><a href="${escapeHtml(r.url)}">${escapeHtml(slug(r.url))}</a></td>
      <td><code>${escapeHtml(r.status)}</code></td>
    </tr>`,
    )
    .join('');
}

export function buildPdpCartFastReportHtml(s: PdpCartFastSummary, baseUrl: string): string {
  const devices = byDevice(s.results);
  const passColour = s.failed === 0 ? '#2e7d32' : s.passed === 0 ? '#d32f2f' : '#f57c00';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>PDP Add to Cart Report</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1525;color:#e7ecf5;padding:24px}
  h1{font-size:1.6rem}h2{font-size:1.05rem;margin:26px 0 10px;color:#aab6d6}
  .meta{font-size:.8rem;color:#7e8aad;margin-bottom:18px}
  .muted{color:#7e8aad}
  .kpis{display:flex;flex-wrap:wrap;gap:12px}
  .kpi{background:#182238;border-radius:10px;padding:16px 22px;min-width:140px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.4)}
  .kpi-num{font-size:2.1rem;font-weight:800}
  .kpi-lbl{font-size:.7rem;color:#8c99bd;text-transform:uppercase;letter-spacing:.5px;margin-top:4px}
  .card{background:#182238;border-radius:10px;padding:18px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.4)}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;padding:9px 10px;font-size:.72rem;text-transform:uppercase;color:#8c99bd;border-bottom:1px solid #2a3550}
  td{padding:9px 10px;font-size:.82rem;border-bottom:1px solid #222c44;vertical-align:top}
  a{color:#9fd0ff}
  .banner{border-radius:10px;padding:14px 18px;margin-bottom:18px;font-size:.92rem;background:#1b2742;border:1px solid #2a3550}
  @media print{
    body{background:#fff;color:#1c2533}
    .card,.kpi{background:#fff;color:#1c2533;box-shadow:none;border:1px solid #dfe5ef}
    .banner{background:#f5f7fb;border:1px solid #dfe5ef}
    h2,.muted,.meta,.kpi-lbl{color:#5d6b82}
  }
</style></head><body>
<h1>🛒 PDP Add-to-Cart Report</h1>
<p class="meta">${escapeHtml(s.generatedAt)} · ${escapeHtml(baseUrl)} · ${s.totalUrls} PDP(s) × ${s.deviceProfiles} device profile(s) = ${s.totalChecks} checks · run time ${(s.totalMs / 1000).toFixed(1)}s</p>

<div class="banner">Each PDP was loaded, then validated for add-to-cart (button visible &amp; enabled → click → cart drawer/count reflects the product) on every device profile. The tables below list exactly which PDP failed, on which device, and why.</div>

<div class="kpis">
  ${gauge('PDP URLs', s.totalUrls)}
  ${gauge('Device Profiles', s.deviceProfiles)}
  ${gauge('Total Checks', s.totalChecks)}
  ${gauge('Passed', s.passed, '#2e7d32')}
  ${gauge('Failed', s.failed, s.failed ? '#d32f2f' : '#2e7d32')}
  ${gauge('Pass Rate', pct(s.passed, s.passed + s.failed), passColour)}
  ${s.skipped ? gauge('Skipped', s.skipped, '#f57c00') : ''}
</div>

<h2>Coverage by Device Profile</h2>
<div class="card"><table>
  <thead><tr><th>Device profile</th><th style="text-align:right">Tested</th><th style="text-align:right">Passed</th><th style="text-align:right">Failed</th><th style="text-align:right">Pass rate</th></tr></thead>
  <tbody>${deviceRows(devices)}</tbody>
</table></div>

<h2>🐢 Slowest PDPs</h2>
<div class="card"><table>
  <thead><tr><th style="text-align:right">Duration</th><th>Device</th><th>Product (PDP)</th></tr></thead>
  <tbody>${slowestRows(s.results)}</tbody>
</table></div>

<h2>↻ Retried / Flaky PDPs</h2>
<div class="card"><table>
  <thead><tr><th style="text-align:right">Retries</th><th>Device</th><th>Product (PDP)</th><th>Final status</th></tr></thead>
  <tbody>${retriedRows(s.results)}</tbody>
</table></div>

<h2>❌ Add-to-Cart Failures (PDP × device)</h2>
<div class="card"><table>
  <thead><tr><th>Product (PDP)</th><th>Device</th><th>Reason</th></tr></thead>
  <tbody>${failRows(s.failures)}</tbody>
</table></div>

<p class="meta" style="margin-top:18px">Artifacts: <code>reports/pdp-cart-fast-summary.json</code> · <code>reports/pdp-cart-dashboard.html</code> · <code>reports/pdp-cart-report.pdf</code></p>
</body></html>`;
}
