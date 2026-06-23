/**
 * html.ts — Core HTML report writers + scoring primitive.
 *
 * Exports:
 *   scoreFromIssues   — pure scoring function reused by score-engine
 *   writeWebsiteMapHtml — crawler map → HTML
 *   writeAreaReport   — SiteReport filtered by area → HTML
 */

import { writeFile } from 'node:fs/promises';
import { ensureDir } from '../utils/fs.js';
import { dirname } from 'node:path';
import type { SiteReport, ValidationIssue, WebsiteMap } from '../types.js';

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const SEVERITY_PENALTY: Record<string, number> = {
  critical: 25,
  high: 10,
  medium: 4,
  low: 1,
  info: 0,
};

/**
 * Pure scoring function: starts at 100, subtracts per-issue penalties
 * normalised by page count so large crawls don't crater scores unfairly.
 *
 * @param issues  Issues to score (pre-filtered by caller if needed).
 * @param area    If provided, only issues whose `area` matches are counted.
 * @param pages   Number of pages tested (used for normalisation, min 1).
 */
export function scoreFromIssues(
  issues: ValidationIssue[],
  area?: ValidationIssue['area'] | string,
  pages = 1,
): number {
  const filtered = area ? issues.filter((i) => i.area === area) : issues;
  if (filtered.length === 0) return 100;

  const normPages = Math.max(1, pages);
  // Penalty grows with issue count but is dampened by sqrt(pages)
  // so 10 issues on 50 pages is not the same weight as 10 issues on 1 page.
  const rawPenalty = filtered.reduce((sum, i) => sum + (SEVERITY_PENALTY[i.severity] ?? 0), 0);
  const dampened = rawPenalty / Math.sqrt(normPages);
  return Math.max(0, Math.min(100, Math.round(100 - dampened)));
}

// ---------------------------------------------------------------------------
// Shared HTML helpers
// ---------------------------------------------------------------------------

function severityBadge(severity: string): string {
  const colours: Record<string, string> = {
    critical: '#d32f2f',
    high: '#e64a19',
    medium: '#f57c00',
    low: '#388e3c',
    info: '#0288d1',
  };
  const bg = colours[severity] ?? '#666';
  return `<span style="background:${bg};color:#fff;padding:2px 7px;border-radius:3px;font-size:11px;font-weight:600;text-transform:uppercase;">${severity}</span>`;
}

function htmlShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f6fa;color:#222;padding:24px}
  h1{font-size:1.6rem;margin-bottom:4px}
  h2{font-size:1.1rem;margin:20px 0 8px;color:#444}
  .meta{font-size:.8rem;color:#888;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;background:#fff;border-radius:6px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)}
  th{background:#1565c0;color:#fff;text-align:left;padding:10px 12px;font-size:.78rem;text-transform:uppercase;letter-spacing:.5px}
  td{padding:9px 12px;font-size:.82rem;border-bottom:1px solid #eee;vertical-align:top}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:#f0f4ff}
  .card{background:#fff;border-radius:6px;padding:16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  .stat{display:inline-block;margin-right:24px}
  .stat-value{font-size:1.8rem;font-weight:700;color:#1565c0}
  .stat-label{font-size:.75rem;color:#888;margin-top:2px}
  a{color:#1565c0;text-decoration:none}
  a:hover{text-decoration:underline}
  code{font-size:.8rem;background:#f0f0f0;padding:1px 4px;border-radius:3px}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// writeWebsiteMapHtml
// ---------------------------------------------------------------------------

/**
 * Writes an HTML page showing the crawled website map.
 */
export async function writeWebsiteMapHtml(map: WebsiteMap, outputPath: string): Promise<void> {
  await ensureDir(dirname(outputPath));

  const byCategory = new Map<string, typeof map.pages>();
  for (const page of map.pages) {
    const cat = page.category ?? 'other';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(page);
  }

  const categorySections = [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, pages]) => {
      const rows = pages.map((p) => `
        <tr>
          <td><a href="${p.url}" target="_blank">${p.url}</a></td>
          <td>${p.title || '—'}</td>
          <td>${p.depth}</td>
          <td>${p.status ?? '—'}</td>
          <td>${p.links.length}</td>
          <td>${p.forms}</td>
        </tr>`).join('');
      return `<h2>${cat} (${pages.length})</h2>
      <table>
        <thead><tr><th>URL</th><th>Title</th><th>Depth</th><th>Status</th><th>Links</th><th>Forms</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    }).join('\n');

  const body = `
    <h1>Website Map</h1>
    <p class="meta">Generated ${map.generatedAt} · Base URL: ${map.baseUrl}</p>
    <div class="card">
      <div class="stat"><div class="stat-value">${map.totalPages}</div><div class="stat-label">Pages discovered</div></div>
      <div class="stat"><div class="stat-value">${byCategory.size}</div><div class="stat-label">Categories</div></div>
    </div>
    ${categorySections}`;

  await writeFile(outputPath, htmlShell('Website Map', body), 'utf8');
}

// ---------------------------------------------------------------------------
// writeAreaReport
// ---------------------------------------------------------------------------

/**
 * Writes a filtered HTML report showing issues for a given area (e.g. 'lighthouse', 'seo').
 */
export async function writeAreaReport(
  report: SiteReport,
  area: string,
  title: string,
  outputPath: string,
): Promise<void> {
  await ensureDir(dirname(outputPath));

  const issues = report.issues.filter((i) => i.area === area);
  const score = scoreFromIssues(issues, area, report.pagesTested);

  const scoreColour = score >= 90 ? '#388e3c' : score >= 70 ? '#f57c00' : '#d32f2f';

  const rows = issues.length
    ? issues.map((i) => `
      <tr>
        <td>${severityBadge(i.severity)}</td>
        <td><a href="${i.pageUrl}" target="_blank">${i.pageUrl}</a></td>
        <td>${i.summary}</td>
        <td>${i.suggestedFix ?? '—'}</td>
      </tr>`).join('')
    : `<tr><td colspan="4" style="text-align:center;color:#888;padding:24px;">No issues found in this area.</td></tr>`;

  const body = `
    <h1>${title}</h1>
    <p class="meta">Generated ${report.generatedAt} · Base URL: ${report.baseUrl} · Pages tested: ${report.pagesTested}</p>
    <div class="card">
      <div class="stat">
        <div class="stat-value" style="color:${scoreColour}">${score}</div>
        <div class="stat-label">Area score (0–100)</div>
      </div>
      <div class="stat">
        <div class="stat-value">${issues.length}</div>
        <div class="stat-label">Issues</div>
      </div>
    </div>
    <h2>Issues</h2>
    <table>
      <thead><tr><th>Severity</th><th>URL</th><th>Summary</th><th>Suggested Fix</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  await writeFile(outputPath, htmlShell(title, body), 'utf8');
}
