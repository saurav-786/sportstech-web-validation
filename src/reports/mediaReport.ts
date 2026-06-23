/**
 * mediaReport.ts — comprehensive PDP/site media dashboard.
 * Inventories EVERY image and video (with size, format, dimensions, status) on
 * the audited pages, on both mobile and desktop, plus per-page weight and an
 * issues list. Self-contained (inline CSS), no external dependencies.
 */
import type { MediaAsset, MediaPageResult } from '../types.js';

function kb(bytes: number): string { return `${Math.round(bytes / 1024).toLocaleString()} KB`; }
function mb(bytes: number): string { return `${(bytes / 1048576).toFixed(2)} MB`; }
function sevColour(s: string): string {
  return ({ critical: '#d32f2f', high: '#e64a19', medium: '#f57c00', low: '#388e3c', info: '#0288d1' } as Record<string, string>)[s] ?? '#666';
}
function shortUrl(url: string): string { return url.replace(/^https?:\/\/[^/]+/, '') || '/'; }
function esc(s: string): string { return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c)); }

export function buildMediaReportHtml(results: MediaPageResult[]): string {
  const flaggedUrls = new Set<string>();
  for (const r of results) for (const i of r.issues) if (i.evidence) flaggedUrls.add(i.evidence);

  // Group by URL → {mobile, desktop} for the weight comparison.
  const byUrl = new Map<string, { mobile?: MediaPageResult; desktop?: MediaPageResult }>();
  for (const r of results) {
    const e = byUrl.get(r.url) ?? {};
    e[r.formFactor] = r;
    byUrl.set(r.url, e);
  }

  const allIssues = results.flatMap((r) => r.issues);
  const allImages = results.reduce((s, r) => s + r.images.length, 0);
  const allVideos = results.reduce((s, r) => s + r.videos.length, 0);
  const totalDesktop = results.filter((r) => r.formFactor === 'desktop').reduce((s, r) => s + r.totalImageBytes + r.totalVideoBytes, 0);
  const totalMobile = results.filter((r) => r.formFactor === 'mobile').reduce((s, r) => s + r.totalImageBytes + r.totalVideoBytes, 0);
  const brokenCount = allIssues.filter((i) => /broken/i.test(i.summary)).length;
  const oversizedCount = allIssues.filter((i) => /oversized|heavy/i.test(i.summary)).length;

  // --- Per-page weight table ---
  const weightRows = [...byUrl.entries()].map(([url, ff]) => {
    const total = (r?: MediaPageResult) => r ? r.totalImageBytes + r.totalVideoBytes : 0;
    const flag = (r?: MediaPageResult) => r ? r.issues.length : 0;
    const d = ff.desktop; const m = ff.mobile;
    return `<tr>
      <td style="font-size:.78rem;word-break:break-all"><a href="${url}" target="_blank">${shortUrl(url)}</a></td>
      <td style="text-align:right">${d ? mb(total(d)) : '—'}</td>
      <td style="text-align:right">${d ? `${d.images.length}/${d.videos.length}` : '—'}</td>
      <td style="text-align:right">${m ? mb(total(m)) : '—'}</td>
      <td style="text-align:right">${m ? `${m.images.length}/${m.videos.length}` : '—'}</td>
      <td style="text-align:right;font-weight:600;color:${(flag(m) + flag(d)) ? '#d32f2f' : '#388e3c'}">${flag(m) + flag(d)}</td>
    </tr>`;
  }).join('');

  // --- Full asset inventory (every image + video) ---
  const assetRow = (a: MediaAsset, page: string, device: string): string => {
    const status = a.broken ? '<span class="tag" style="background:#d32f2f">BROKEN</span>'
      : flaggedUrls.has(a.url) ? '<span class="tag" style="background:#f57c00">FLAGGED</span>'
      : a.notDownloaded ? '<span class="tag" style="background:#90a4ae">lazy</span>'
      : '<span class="tag" style="background:#2e7d32">ok</span>';
    const dims = a.naturalWidth ? `${a.naturalWidth}×${a.naturalHeight}` : (a.durationSec ? `${a.durationSec}s` : '—');
    return `<tr>
      <td>${a.kind}</td>
      <td>${a.format || '—'}</td>
      <td style="font-size:.74rem;word-break:break-all"><a href="${esc(a.url)}" target="_blank">${esc(shortUrl(a.url)).slice(0, 90)}</a></td>
      <td>${dims}</td>
      <td style="text-align:right">${a.bytes ? kb(a.bytes) : '—'}</td>
      <td>${device}</td>
      <td style="font-size:.72rem">${esc(shortUrl(page))}</td>
      <td>${status}</td>
    </tr>`;
  };
  const inventory: string[] = [];
  for (const r of results) {
    for (const a of [...r.videos, ...r.images]) inventory.push(assetRow(a, r.url, r.device));
  }
  // Heaviest first by bytes for usefulness.
  const inventoryRows = inventory.slice(0, 1200).join('') || `<tr><td colspan="8" style="text-align:center;color:#888;padding:18px">No media inventoried.</td></tr>`;

  // --- Videos spotlight ---
  const videoAssets = results.flatMap((r) => r.videos.map((v) => ({ v, page: r.url, device: r.device })));
  const videoRows = videoAssets.length ? videoAssets.map(({ v, page, device }) => `<tr>
    <td>${v.format || '—'}</td>
    <td style="font-size:.74rem;word-break:break-all"><a href="${esc(v.url)}" target="_blank">${esc(shortUrl(v.url)).slice(0, 100)}</a></td>
    <td style="text-align:right">${v.bytes ? mb(v.bytes) : (v.notDownloaded ? 'not loaded' : '—')}</td>
    <td>${v.durationSec ? `${v.durationSec}s` : '—'}</td>
    <td>${v.poster ? '✓' : '✗'}</td>
    <td>${v.preload ?? '—'}</td>
    <td>${device}</td>
  </tr>`).join('') : `<tr><td colspan="7" style="text-align:center;color:#888;padding:18px">No videos found on audited pages.</td></tr>`;

  // --- Issues ---
  const issueRows = allIssues.slice(0, 400).map((i) => `<tr>
    <td><span class="sev" style="background:${sevColour(i.severity)}">${i.severity}</span></td>
    <td>${i.device ?? '—'}</td>
    <td>${esc(i.summary)}</td>
    <td style="font-size:.78rem">${esc(i.suggestedFix ?? '—')}</td>
  </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:#888;padding:18px">No media issues 🎉</td></tr>';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Media Audit Dashboard — Sportstech</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f6fb;color:#1c2533;padding:24px;max-width:1200px;margin:0 auto}
  h1{font-size:1.6rem}h2{font-size:1.05rem;margin:26px 0 8px;color:#1565c0;border-bottom:2px solid #e0e6f0;padding-bottom:5px}
  .meta{font-size:.8rem;color:#7a8aa0;margin-bottom:14px}
  .kpis{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px}
  .kpi{background:#fff;border-radius:9px;padding:12px 18px;min-width:120px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.07)}
  .kpi b{font-size:1.6rem;display:block}.kpi span{font-size:.66rem;color:#8a97ad;text-transform:uppercase}
  table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.07);margin-bottom:6px}
  th{background:#1565c0;color:#fff;text-align:left;padding:8px 10px;font-size:.68rem;text-transform:uppercase;position:sticky;top:0}
  td{padding:7px 10px;font-size:.8rem;border-bottom:1px solid #eef1f6;vertical-align:top}
  tr:hover td{background:#f0f4ff}
  .tag,.sev{color:#fff;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700}
  .sev{border-radius:3px}
  a{color:#1565c0;text-decoration:none}a:hover{text-decoration:underline}
  details{margin-bottom:16px}summary{cursor:pointer;font-weight:600;color:#1565c0;margin:10px 0}
  .scroll{max-height:520px;overflow:auto;border-radius:8px}
</style></head><body>
<h1>🎞️ Media Audit Dashboard — Sportstech.de</h1>
<p class="meta">${byUrl.size} page(s) audited on desktop + mobile · ${allImages + allVideos} assets inventoried · ${allIssues.length} issue(s)</p>

<div class="kpis">
  <div class="kpi"><b>${byUrl.size}</b><span>Pages</span></div>
  <div class="kpi"><b>${allImages}</b><span>Images</span></div>
  <div class="kpi"><b>${allVideos}</b><span>Videos</span></div>
  <div class="kpi"><b>${mb(totalDesktop)}</b><span>Desktop weight</span></div>
  <div class="kpi"><b>${mb(totalMobile)}</b><span>Mobile weight</span></div>
  <div class="kpi"><b style="color:${oversizedCount ? '#e64a19' : '#2e7d32'}">${oversizedCount}</b><span>Oversized</span></div>
  <div class="kpi"><b style="color:${brokenCount ? '#d32f2f' : '#2e7d32'}">${brokenCount}</b><span>Broken</span></div>
</div>

<h2>Per-page weight — Desktop vs Mobile</h2>
<table>
  <thead><tr><th>Page</th><th style="text-align:right">Desktop</th><th style="text-align:right">D img/vid</th><th style="text-align:right">Mobile</th><th style="text-align:right">M img/vid</th><th style="text-align:right">Issues</th></tr></thead>
  <tbody>${weightRows}</tbody>
</table>

<h2>Videos (${videoAssets.length})</h2>
<table>
  <thead><tr><th>Format</th><th>URL</th><th style="text-align:right">Size</th><th>Duration</th><th>Poster</th><th>Preload</th><th>Device</th></tr></thead>
  <tbody>${videoRows}</tbody>
</table>

<h2>Media issues (${allIssues.length})</h2>
<table>
  <thead><tr><th>Severity</th><th>Device</th><th>Issue</th><th>Suggested fix</th></tr></thead>
  <tbody>${issueRows}</tbody>
</table>

<h2>Full asset inventory (${allImages + allVideos})</h2>
<details open><summary>Every image &amp; video on the audited pages (capped at 1200 rows)</summary>
<div class="scroll"><table>
  <thead><tr><th>Kind</th><th>Format</th><th>URL</th><th>Dimensions</th><th style="text-align:right">Size</th><th>Device</th><th>Page</th><th>Status</th></tr></thead>
  <tbody>${inventoryRows}</tbody>
</table></div>
</details>

<p class="meta">Budgets (image KB / video MB, mobile & desktop) are configurable via MEDIA_* env vars. Self-contained report; share by attaching this file.</p>
</body></html>`;
}
