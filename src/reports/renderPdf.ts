/**
 * renderPdf.ts — CLI entry point for the shared HTML -> PDF renderer.
 *
 * Usage:
 *   npm run pdf
 *   REPORT_HTML=reports/revenue-dashboard.html OUTPUT_PDF=reports/revenue-report.pdf npm run pdf
 *   npm run pdf -- --input reports/investigation-report.html --output reports/investigation-report.pdf
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { appConfig } from '../config.js';
import { createLogger } from '../utils/logger.js';
import { renderHtmlReportToPdf } from './pdf.js';

const log = createLogger('render-pdf');

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const dashPath = arg('--input')
  ?? process.env.REPORT_HTML
  ?? join(appConfig.reportsDir, 'dashboard.html');
const outPath = resolve(
  arg('--output')
  ?? process.env.OUTPUT_PDF
  ?? join(appConfig.reportsDir, 'executive-summary.pdf'),
);

if (!existsSync(dashPath)) {
  log.warn(`Dashboard not found: ${resolve(dashPath)}`);
  log.warn('Run "npm run scan" or "npm run report:suites" first to generate reports.');
  process.exit(0);
} else {
  log.info(`Rendering PDF from ${resolve(dashPath)} …`);
  const rendered = await renderHtmlReportToPdf({
    inputHtml: dashPath,
    outputPdf: outPath,
    title: process.env.PDF_TITLE ?? 'Website Validation Executive Report',
    preserveScreenTheme: process.env.PDF_PRESERVE_THEME === '1',
  });
  log.info(`PDF saved: ${rendered}`);
}
