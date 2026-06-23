/**
 * runPdpCartFastReport.ts — post-run report builder for the fast @pdp-cart-fast
 * add-to-cart suite.
 *
 * Reads the summary JSON written by tests/pdp-cart/summaryReporter.ts, renders an
 * HTML dashboard, and exports it to PDF via the shared renderer. Designed to be
 * chained AFTER the Playwright run (and to run even when some tests failed), so it
 * never throws on missing input — it logs clearly and exits 0 so the original test
 * exit code is preserved by the calling script.
 *
 *   npm run test:pdp-cart        (runs the suite, then this)
 *   npm run report:pdp-cart      (just this, against the last run's summary)
 */
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appConfig } from '../config.js';
import { ensureDir, readJson } from '../utils/fs.js';
import { createLogger } from '../utils/logger.js';
import { renderHtmlReportToPdf } from '../reports/pdf.js';
import { buildPdpCartFastReportHtml, type PdpCartFastSummary } from '../reports/pdpCartFastReport.js';

const log = createLogger('pdp-cart-report');

const reportsDir = appConfig.reportsDir;
const summaryPath = join(reportsDir, 'pdp-cart-fast-summary.json');
const htmlPath = join(reportsDir, 'pdp-cart-dashboard.html');
const pdfPath = join(reportsDir, 'pdp-cart-report.pdf');

async function main(): Promise<void> {
  if (!existsSync(summaryPath)) {
    log.warn(
      `No summary found at ${summaryPath}. The @pdp-cart-fast suite did not produce results ` +
        `(no PDP URLs, or the suite was not run). Skipping dashboard/PDF generation.`,
    );
    return;
  }

  const summary = await readJson<PdpCartFastSummary>(summaryPath);
  await ensureDir(reportsDir);

  // Console summary (mirrors the in-run reporter, useful when this runs standalone).
  log.info(
    `Tests: ${summary.totalChecks} · passed ${summary.passed} · failed ${summary.failed} · ` +
      `skipped ${summary.skipped} · ${summary.totalUrls} URL(s) × ${summary.deviceProfiles} device profile(s) · ` +
      `${(summary.totalMs / 1000).toFixed(1)}s`,
  );

  // 1. HTML dashboard.
  try {
    await writeFile(htmlPath, buildPdpCartFastReportHtml(summary, appConfig.baseUrl), 'utf8');
    log.info(`✅ Dashboard generated: ${htmlPath}`);
  } catch (err) {
    log.error(`❌ Dashboard generation FAILED: ${err instanceof Error ? err.message : String(err)}`);
    return; // no point trying the PDF if the HTML source is missing
  }

  // 2. PDF (rendered from the dashboard; failure is non-fatal and clearly logged).
  try {
    const out = await renderHtmlReportToPdf({
      inputHtml: htmlPath,
      outputPdf: pdfPath,
      title: 'PDP Add-to-Cart Report',
      preserveScreenTheme: true,
    });
    log.info(`✅ PDF report generated: ${out}`);
  } catch (err) {
    log.error(
      `❌ PDF generation FAILED: ${err instanceof Error ? err.message : String(err)}. ` +
        `The HTML dashboard is still available at ${htmlPath}.`,
    );
  }
}

main().catch((err) => {
  // Never mask the test run's exit status — log loudly but don't hang or crash the chain.
  log.error(`Report builder error: ${err instanceof Error ? err.message : String(err)}`);
});
