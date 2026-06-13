#!/usr/bin/env node
/**
 * Assemble the static site that Vercel publishes.
 *
 * Inputs:
 *   reports/                   — produced by `npm run scan` (or any test:* suite)
 *   environment variables      — set by CI for provenance metadata
 *
 * Outputs:
 *   dist/                      — the directory Vercel serves
 *     index.html               — landing page linking to every available report
 *     manifest.json            — machine-readable scan metadata (Option B foundation)
 *     robots.txt               — noindex / nofollow (this is a private review site)
 *     <copies of every file from reports/>
 *
 * Design goals:
 *   - Zero runtime dependencies (Node ≥ 18 built-ins only) so `vercel build`
 *     doesn't need `npm install`.
 *   - Graceful degradation: if `reports/` is missing or empty, still produce a
 *     valid landing page that explains the situation instead of failing the deploy.
 *   - Idempotent: rerunning produces the same dist/ for the same inputs.
 */

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const REPORTS_DIR = join(REPO_ROOT, 'reports');
const DIST_DIR = join(REPO_ROOT, 'dist');
/**
 * Reports that, if present, should appear on the landing page as a primary
 * tile. Order here drives display order. Each entry: [filename, label,
 * description]. Anything in reports/ that isn't in this list is still copied
 * to dist/ — it just won't get a tile (linkable from the dashboards themselves).
 */
const KNOWN_REPORTS = [
    ['dashboard.html', 'Main Dashboard', 'Severity-ranked defects, heat maps, AI summary, trends'],
    ['executive-dashboard.html', 'Executive Summary', 'High-level release-readiness verdict and blockers'],
    ['dashboard-shareable.html', 'Shareable Snapshot', 'Self-contained single-file dashboard for email / Teams'],
    ['website-map.html', 'Website Map', 'Discovered pages, navigation, and categorization'],
    ['seo-report.html', 'SEO Report', 'Titles, descriptions, canonicals, structured data, sitemap'],
    ['accessibility-report.html', 'Accessibility Report', 'WCAG 2.1 A/AA findings with axe-core severity'],
    ['security-report.html', 'Security Report', 'CSP, HSTS, cookies, mixed content, XSS surface'],
    ['performance-report.html', 'Performance Report', 'Core Web Vitals vs budgets'],
    ['lighthouse-report.html', 'Lighthouse Audit', 'Desktop + mobile Lighthouse scores'],
    ['lighthouse-trends.html', 'Lighthouse Trends', 'Score history over time'],
    ['image-validation-report.html', 'Image Validation', 'Broken / oversized / missing alt'],
    ['heatmap-report.html', 'Heatmap Detection', 'GA, GTM, Meta Pixel, Hotjar, Clarity, CrazyEgg'],
    ['analytics-report.html', 'Analytics Report', 'Tag and tracker coverage'],
    ['page-exploration-report.html', 'Page Exploration', 'Scroll engine coverage and per-page screenshots'],
    ['playwright-report/index.html', 'Playwright Test Report', 'Raw test results: traces, screenshots, videos'],
    ['executive-summary.pdf', 'Executive PDF', 'Printable executive summary'],
];

async function main() {
    const startedAt = Date.now();
    console.log('[build-vercel-site] assembling dist/ for Vercel deployment');

    // Fresh start so nothing stale leaks into the deploy.
    if (existsSync(DIST_DIR)) {
        await rm(DIST_DIR, { recursive: true, force: true });
    }
    await mkdir(DIST_DIR, { recursive: true });

    const reportsExist = existsSync(REPORTS_DIR);
    const copied = reportsExist ? await copyReports() : [];
    const availableReports = pickAvailable(copied);
    const meta = buildManifest({ reportsExist, copied, availableReports });

    await writeFile(join(DIST_DIR, 'manifest.json'), JSON.stringify(meta, null, 2) + '\n');
    await writeFile(join(DIST_DIR, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
    await writeFile(join(DIST_DIR, 'index.html'), renderLandingPage(meta));

    const durationMs = Date.now() - startedAt;
    console.log(
        `[build-vercel-site] done in ${durationMs}ms — ` +
        `${copied.length} files copied, ${availableReports.length} report tiles, ` +
        `reportsExist=${reportsExist}`,
    );
}
/**
 * Recursively copy reports/ into dist/, returning the list of relative file
 * paths actually present.
 */
async function copyReports() {
    await cp(REPORTS_DIR, DIST_DIR, {
        recursive: true,
        // Don't overwrite the files we generate (index.html, manifest.json, robots.txt).
        // None of those should be in reports/ anyway, but defense in depth.
        filter: (src) => {
            const rel = relative(REPORTS_DIR, src);
            if (rel === 'index.html' || rel === 'manifest.json' || rel === 'robots.txt') {
                console.warn(`[build-vercel-site] skipping ${rel} from reports/ — generated by build`);
                return false;
            }
            return true;
        },
    });
    return await listFiles(DIST_DIR);
}

async function listFiles(root) {
    const out = [];
    async function walk(dir) {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) await walk(full);
            else if (entry.isFile()) out.push(relative(root, full).split(/[\\/]+/).join('/'));
        }
    }
    await walk(root);
    return out.sort();
}

function pickAvailable(copiedFiles) {
    const set = new Set(copiedFiles);
    return KNOWN_REPORTS
        .filter(([file]) => set.has(file))
        .map(([file, label, description]) => ({ file, label, description }));
}

function buildManifest({ reportsExist, copied, availableReports }) {
    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        git: {
            sha: process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA || null,
            ref: process.env.GITHUB_REF_NAME || process.env.VERCEL_GIT_COMMIT_REF || null,
            repository: process.env.GITHUB_REPOSITORY || process.env.VERCEL_GIT_REPO_SLUG || null,
        },
        scan: {
            type: process.env.SCAN_TYPE || 'unspecified',
            baseUrl: process.env.BASE_URL || null,
            workflowRunId: process.env.GITHUB_RUN_ID || null,
            workflowRunUrl: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
                ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
                : null,
        },
        reports: {
            directoryPresent: reportsExist,
            fileCount: copied.length,
            availableTiles: availableReports,
        },
    };
}
/**
 * Render a small, dependency-free landing page. Inline CSS only — no fonts,
 * no scripts, no external resources, so it works even with the strictest CSP
 * and inside Vercel's authentication gate.
 */
function renderLandingPage(meta) {
    const tiles = meta.reports.availableTiles
        .map(
            (r) => `
      <li>
        <a class="tile" href="/${r.file}">
          <h3>${escapeHtml(r.label)}</h3>
          <p>${escapeHtml(r.description)}</p>
          <span class="tile-link">Open →</span>
        </a>
      </li>`,
        )
        .join('');

    const emptyState = meta.reports.availableTiles.length === 0
        ? `<div class="empty">
         <h2>No reports available yet</h2>
         <p>The most recent scan did not produce any report files.
         ${meta.scan.workflowRunUrl ? `Check the <a href="${escapeAttr(meta.scan.workflowRunUrl)}">CI run</a> for details.` : 'Trigger a scan in CI and redeploy.'}</p>
       </div>`
        : '';

    const sha = meta.git.sha ? meta.git.sha.slice(0, 7) : 'unknown';
    const generated = meta.generatedAt;
    const baseUrl = meta.scan.baseUrl ? escapeHtml(meta.scan.baseUrl) : '—';
    const scanType = meta.scan.type ? escapeHtml(meta.scan.type) : 'unspecified';

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Sportstech Web Validation — Stakeholder Review</title>
  <style>
    :root {
      --bg: #0b1220;
      --panel: #131b2e;
      --panel-2: #1a2440;
      --text: #e6edf6;
      --muted: #94a3b8;
      --accent: #6ee7b7;
      --accent-2: #38bdf8;
      --border: #243154;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      background: linear-gradient(180deg, #060a16 0%, #0b1220 100%);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.5;
      min-height: 100vh;
    }
    main { max-width: 1100px; margin: 0 auto; padding: 48px 24px 64px; }
    header.hero {
      border: 1px solid var(--border);
      background: var(--panel);
      border-radius: 16px;
      padding: 32px;
      margin-bottom: 32px;
    }
    h1 { font-size: 28px; margin: 0 0 8px; letter-spacing: -0.01em; }
    .tagline { color: var(--muted); margin: 0 0 24px; }
    .meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }
    .meta div {
      background: var(--panel-2);
      padding: 12px 14px;
      border-radius: 8px;
      border: 1px solid var(--border);
    }
    .meta dt { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; margin: 0; }
    .meta dd { color: var(--text); font-size: 14px; margin: 4px 0 0; word-break: break-word; }
    .ci-link { color: var(--accent-2); }
    h2 { font-size: 18px; margin: 32px 0 16px; color: var(--accent); letter-spacing: 0.01em; }
    ul.tiles { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
    .tile {
      display: block;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 18px 20px;
      color: var(--text);
      text-decoration: none;
      transition: transform 0.12s ease, border-color 0.12s ease, background 0.12s ease;
    }
    .tile:hover { border-color: var(--accent-2); background: var(--panel-2); transform: translateY(-1px); }
    .tile h3 { margin: 0 0 6px; font-size: 16px; }
    .tile p { margin: 0 0 12px; color: var(--muted); font-size: 13px; min-height: 38px; }
    .tile-link { color: var(--accent-2); font-size: 13px; }
    .empty {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 28px;
      text-align: center;
    }
    .empty h2 { color: var(--text); margin-top: 0; }
    .empty a { color: var(--accent-2); }
    footer { color: var(--muted); font-size: 12px; margin-top: 40px; text-align: center; }
    code { background: var(--panel-2); padding: 1px 6px; border-radius: 4px; font-size: 12px; }
  </style>
</head>
<body>
  <main>
    <header class="hero">
      <h1>Sportstech Web Validation</h1>
      <p class="tagline">Latest automated validation results for ${baseUrl}. Restricted to authorized reviewers — please do not share links externally.</p>
      <dl class="meta">
        <div><dt>Generated</dt><dd>${escapeHtml(generated)}</dd></div>
        <div><dt>Scan type</dt><dd>${scanType}</dd></div>
        <div><dt>Target</dt><dd>${baseUrl}</dd></div>
        <div><dt>Commit</dt><dd>${escapeHtml(sha)}</dd></div>
        ${meta.scan.workflowRunUrl ? `<div><dt>CI run</dt><dd><a class="ci-link" href="${escapeAttr(meta.scan.workflowRunUrl)}">View workflow →</a></dd></div>` : ''}
      </dl>
    </header>

    ${emptyState}
    ${meta.reports.availableTiles.length > 0 ? `<h2>Reports</h2><ul class="tiles">${tiles}</ul>` : ''}

    <footer>
      <p>Hosted on Vercel · Access protected · <code>manifest.json</code> available for tooling</p>
    </footer>
  </main>
</body>
</html>
`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
    return escapeHtml(value);
}

main().catch((err) => {
    console.error('[build-vercel-site] failed:', err);
    process.exit(1);
});