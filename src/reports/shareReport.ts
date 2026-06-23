/**
 * shareReport.ts — Produces a single self-contained shareable HTML file
 * from the existing dashboard.html, inlining linked resources so it can be
 * attached in Teams/email/wiki without additional files.
 *
 * Exports:
 *   buildShareableReport — returns path to the shareable file or undefined
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { appConfig } from '../config.js';
import { ensureDir } from '../utils/fs.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('share-report');

/**
 * Reads the dashboard.html and produces a self-contained shareable copy at
 * reports/dashboard-shareable.html.  Relative href/src references that
 * resolve to local HTML files are inlined as data-URIs.
 *
 * @returns Absolute path to the shareable file, or `undefined` if the
 *          source dashboard does not exist yet.
 */
export async function buildShareableReport(): Promise<string | undefined> {
  const dashPath = join(appConfig.reportsDir, 'dashboard.html');

  if (!existsSync(dashPath)) {
    log.warn(`Dashboard not found at ${resolve(dashPath)} — run the scan first.`);
    return undefined;
  }

  let html = await readFile(dashPath, 'utf8');
  const baseDir = dirname(dashPath);

  // Inline local stylesheets: <link rel="stylesheet" href="...">
  html = await inlineLinks(html, baseDir);

  // Inline local scripts: <script src="...">
  html = await inlineScripts(html, baseDir);

  // Rewrite remaining relative hrefs that point to local HTML to be absolute
  // paths so they still work when the file is opened from a different location.
  html = html.replace(/href="(?!https?:\/\/)([^"]+\.html)"/g, (_, rel) => {
    const abs = resolve(baseDir, rel);
    return `href="${abs}"`;
  });

  const outPath = join(appConfig.reportsDir, 'dashboard-shareable.html');
  await ensureDir(dirname(outPath));
  await writeFile(outPath, html, 'utf8');

  log.info(`Shareable report: ${resolve(outPath)}`);
  return resolve(outPath);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function inlineLinks(html: string, baseDir: string): Promise<string> {
  const pattern = /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["'][^>]*\/?>/gi;
  const matches = [...html.matchAll(pattern)];

  for (const match of matches) {
    const [tag, href] = match;
    if (href.startsWith('http')) continue;
    const filePath = resolve(baseDir, href);
    if (!existsSync(filePath)) continue;
    try {
      const css = await readFile(filePath, 'utf8');
      html = html.replace(tag, `<style>${css}</style>`);
    } catch {
      // leave original tag in place on read error
    }
  }

  return html;
}

async function inlineScripts(html: string, baseDir: string): Promise<string> {
  const pattern = /<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/gi;
  const matches = [...html.matchAll(pattern)];

  for (const match of matches) {
    const [tag, src] = match;
    if (src.startsWith('http')) continue;
    const filePath = resolve(baseDir, src);
    if (!existsSync(filePath)) continue;
    try {
      const js = await readFile(filePath, 'utf8');
      html = html.replace(tag, `<script>${js}</script>`);
    } catch {
      // leave original tag in place on read error
    }
  }

  return html;
}
