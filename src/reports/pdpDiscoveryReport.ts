/**
 * pdpDiscoveryReport.ts — Phase: PDP Discovery.
 *
 * Builds the self-contained "PDP Discovery Report" dashboard (single HTML file,
 * inline CSS, no external deps) as a PEER report to the Revenue Protection
 * dashboard, so it plugs into the existing reporting framework and the shared
 * HTML→PDF renderer (src/reports/pdf.ts) without modifying any existing report.
 *
 * Pure (no I/O) so it stays unit-testable — the spec writes the file.
 */

/** One product link discovered on a category page. */
export interface PdpProduct {
  name: string;
  url: string;
}

/** Per-category discovery outcome. */
export interface PdpCategoryResult {
  /** Slug used as the key in the JSON report (e.g. "laufband"). */
  name: string;
  /** Category page that was scanned. */
  url: string;
  /** Raw product links collected before de-duplication. */
  productsFound: number;
  /** productsFound − finalCount. */
  duplicatesRemoved: number;
  /** Unique, validated PDP URLs kept for this category. */
  finalCount: number;
  /** Product cards seen on the page that exposed no usable link. */
  cardsWithoutLinks: number;
  /** Number of paginated pages walked (1 = single page / infinite scroll). */
  pagesWalked: number;
  /** True when the category page could not be loaded/scanned at all. */
  scanFailed: boolean;
  error?: string;
  products: PdpProduct[];
}

/** A PDP that failed post-discovery validation. */
export interface BrokenPdp {
  url: string;
  category: string;
  status?: number;
  reasons: string[];
}

/** Aggregate report consumed by the dashboard + PDF. */
export interface PdpDiscoveryReport {
  generatedAt: string;
  baseUrl: string;
  totalCategories: number;
  totalProducts: number;
  totalDuplicatesRemoved: number;
  missingProductLinks: number;
  failedCategoryScans: number;
  validatedCount: number;
  categories: PdpCategoryResult[];
  brokenPdps: BrokenPdp[];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
}

function gauge(label: string, value: number | string, colour = '#9fd0ff'): string {
  return `<div class="kpi"><div class="kpi-num" style="color:${colour}">${value}</div><div class="kpi-lbl">${label}</div></div>`;
}

function categoryRows(r: PdpDiscoveryReport): string {
  if (!r.categories.length) return `<tr><td colspan="6" style="text-align:center;color:#888;padding:18px">No categories scanned.</td></tr>`;
  return r.categories.map((c) => {
    const colour = c.scanFailed ? '#d32f2f' : c.finalCount === 0 ? '#f57c00' : '#2e7d32';
    const status = c.scanFailed ? 'Scan failed' : c.finalCount === 0 ? 'No products found' : 'OK';
    return `<tr>
      <td><strong>${escapeHtml(c.name)}</strong><br/><span class="muted" style="font-size:.72rem">${escapeHtml(c.url)}</span></td>
      <td style="text-align:right">${c.productsFound}</td>
      <td style="text-align:right">${c.duplicatesRemoved}</td>
      <td style="text-align:right;font-weight:700">${c.finalCount}</td>
      <td style="text-align:right">${c.cardsWithoutLinks}</td>
      <td style="color:${colour};font-weight:600">${status}${c.error ? `<br/><span class="muted" style="font-size:.7rem">${escapeHtml(c.error)}</span>` : ''}</td>
    </tr>`;
  }).join('');
}

function brokenRows(r: PdpDiscoveryReport): string {
  if (r.validatedCount === 0) return `<tr><td colspan="4" style="text-align:center;color:#7e8aad;padding:18px">PDP validation skipped — re-run with <code>PDP_VALIDATE=1</code> to deep-check each PDP.</td></tr>`;
  if (!r.brokenPdps.length) return `<tr><td colspan="4" style="text-align:center;color:#2e7d32;padding:18px">All validated PDPs passed (HTTP 200 · title · price · add-to-cart · image). 🎉</td></tr>`;
  return r.brokenPdps.map((b) => `<tr>
    <td>${escapeHtml(b.category)}</td>
    <td><a href="${escapeHtml(b.url)}">${escapeHtml(b.url)}</a></td>
    <td style="text-align:right;color:${b.status && b.status >= 400 ? '#d32f2f' : '#f57c00'}">${b.status ?? '—'}</td>
    <td>${escapeHtml(b.reasons.join(', '))}</td>
  </tr>`).join('');
}

export function buildPdpDiscoveryReportHtml(r: PdpDiscoveryReport): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>PDP Discovery Report</title>
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
  a{color:#9fd0ff}
  details summary{cursor:pointer;color:#9fd0ff;font-size:.8rem;margin-top:4px}
  details ul{margin:6px 0 0 18px;font-size:.78rem;color:#b9c4e2}
  @media print{
    body{background:#fff;color:#1c2533}
    .card,.kpi{background:#fff;color:#1c2533;box-shadow:none;border:1px solid #dfe5ef}
    h2,.muted,.meta,.kpi-lbl{color:#5d6b82}
  }
</style></head><body>
<h1>🔎 PDP Discovery Report</h1>
<p class="meta">${r.generatedAt} · ${escapeHtml(r.baseUrl)} · discovered across ${r.totalCategories} product categories</p>

<div class="kpis">
  ${gauge('Categories Scanned', r.totalCategories)}
  ${gauge('Total PDP URLs', r.totalProducts, '#2e7d32')}
  ${gauge('Duplicates Removed', r.totalDuplicatesRemoved, '#f57c00')}
  ${gauge('Missing Product Links', r.missingProductLinks, r.missingProductLinks ? '#f57c00' : '#2e7d32')}
  ${gauge('Failed Category Scans', r.failedCategoryScans, r.failedCategoryScans ? '#d32f2f' : '#2e7d32')}
  ${gauge('PDPs Validated', r.validatedCount)}
  ${gauge('Broken PDPs', r.brokenPdps.length, r.brokenPdps.length ? '#d32f2f' : '#2e7d32')}
</div>

<h2>Products Per Category</h2>
<div class="card"><table>
  <thead><tr><th>Category</th><th style="text-align:right">Found (raw)</th><th style="text-align:right">Duplicates removed</th><th style="text-align:right">Final count</th><th style="text-align:right">Cards w/o link</th><th>Status</th></tr></thead>
  <tbody>${categoryRows(r)}</tbody>
</table></div>

<h2>Broken PDPs (failed validation)</h2>
<div class="card"><table>
  <thead><tr><th>Category</th><th>URL</th><th style="text-align:right">HTTP</th><th>Failed checks</th></tr></thead>
  <tbody>${brokenRows(r)}</tbody>
</table>
  <p class="muted" style="margin-top:8px;font-size:.78rem">Validation checks per PDP: HTTP 200 · product title present · price present · add-to-cart button present · product image present.</p>
</div>

<h2>Discovered PDP URLs</h2>
<div class="card">
  ${r.categories.map((c) => `<details><summary>${escapeHtml(c.name)} — ${c.finalCount} product(s)</summary><ul>${c.products.map((p) => `<li><a href="${escapeHtml(p.url)}">${escapeHtml(p.name || p.url)}</a></li>`).join('') || '<li class="muted">none</li>'}</ul></details>`).join('')}
</div>

<p class="meta" style="margin-top:18px">Artifacts: <code>reports/pdp-discovery.json</code> · <code>reports/pdp-discovery.csv</code></p>
</body></html>`;
}
