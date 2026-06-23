/**
 * runPdpCartReport.ts — aggregates the @pdp-cart suite output (per-device result
 * files) into the cross-browser "Add to Cart → Payment" report: JSON + CSV + HTML
 * dashboard + downloadable PDF (rendered by the shared renderer). Auto-opens the
 * HTML so the findings are immediately visible.
 *
 *   npm run test:pdp-cart   (runs the suite, then this)
 */
import { existsSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appConfig } from '../config.js';
import { ensureDir, readJson, writeJson } from '../utils/fs.js';
import { createLogger } from '../utils/logger.js';
import { renderHtmlReportToPdf } from '../reports/pdf.js';
import { openReport } from '../reports/openReport.js';
import { resolveRevenueRunDir } from '../revenue/runArtifacts.js';
import {
  buildPdpCartReportHtml,
  type PdpCartDeviceSummary,
  type PdpCartReport,
  type PdpCartResult,
} from '../reports/pdpCartReport.js';

const log = createLogger('pdp-cart-report');

async function loadResults(dir: string): Promise<PdpCartResult[]> {
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  const all: PdpCartResult[] = [];
  for (const f of files) {
    try { all.push(...await readJson<PdpCartResult[]>(join(dir, f))); } catch { /* skip malformed */ }
  }
  return all;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function main(): Promise<void> {
  const runDir = await resolveRevenueRunDir();
  const results = await loadResults(join(runDir, 'pdp-cart'));
  if (results.length === 0) {
    log.warn('No PDP cart results found. Run the @pdp-cart suite first (npm run test:pdp-cart).');
  }

  const deviceMap = new Map<string, PdpCartDeviceSummary>();
  for (const r of results) {
    const key = r.device;
    const s = deviceMap.get(key) ?? { device: r.device, browser: r.browser, formFactor: r.formFactor, tested: 0, addToCartOk: 0, addToCartFailed: 0, reachedPayment: 0 };
    s.tested += 1;
    if (r.addedToCart) s.addToCartOk += 1; else s.addToCartFailed += 1;
    if (r.reachedPayment) s.reachedPayment += 1;
    deviceMap.set(key, s);
  }

  const report: PdpCartReport = {
    generatedAt: new Date().toISOString(),
    baseUrl: appConfig.baseUrl,
    paymentMode: appConfig.revenue.paymentMode,
    totalProducts: new Set(results.map((r) => r.url)).size,
    totalRuns: results.length,
    devices: [...deviceMap.values()].sort((a, b) => a.device.localeCompare(b.device)),
    results,
    addToCartFailures: results.filter((r) => !r.addedToCart).sort((a, b) => a.device.localeCompare(b.device)),
    reachedCartNotPayment: results.filter((r) => r.addedToCart && !r.reachedPayment).sort((a, b) => a.device.localeCompare(b.device)),
  };

  await ensureDir(appConfig.reportsDir);
  await writeJson(join(appConfig.reportsDir, 'pdp-cart-report.json'), report);
  await writeJson(join(runDir, 'pdp-cart-report.json'), report);

  // CSV: URL, Category, Device, Browser, FormFactor, AddedToCart, ReachedCart, ReachedCheckout, ReachedPayment, FailedStep
  const rows = ['Product URL,Category,Device,Browser,FormFactor,AddedToCart,ReachedCart,ReachedCheckout,ReachedPayment,FailedStep'];
  for (const r of results) {
    rows.push([r.url, r.category ?? '', r.device, r.browser, r.formFactor, String(r.addedToCart), String(r.reachedCart), String(r.reachedCheckout), String(r.reachedPayment), r.failedStep ?? ''].map(csvCell).join(','));
  }
  await writeFile(join(appConfig.reportsDir, 'pdp-cart-report.csv'), `${rows.join('\n')}\n`, 'utf8');

  const htmlPath = join(appConfig.reportsDir, 'pdp-cart-report.html');
  await writeFile(htmlPath, buildPdpCartReportHtml(report), 'utf8');

  const pdfPath = await renderHtmlReportToPdf({
    inputHtml: htmlPath,
    outputPdf: join(appConfig.reportsDir, 'pdp-cart-report.pdf'),
    title: 'Add to Cart → Payment Report',
    preserveScreenTheme: true,
  }).catch((err: Error) => { log.warn(`PDF render skipped: ${err.message}`); return undefined; });

  log.info(`PDPs: ${report.totalProducts} · runs: ${report.totalRuns} · add-to-cart failures: ${report.addToCartFailures.length} · reached-cart-not-payment: ${report.reachedCartNotPayment.length}`);
  for (const d of report.devices) log.info(`  ${d.device.padEnd(20)} ${d.browser}/${d.formFactor} · tested ${d.tested} · ATC failed ${d.addToCartFailed} · paid ${d.reachedPayment}`);
  log.info(`Report: ${htmlPath}${pdfPath ? ` · PDF: ${pdfPath}` : ''} · JSON/CSV in reports/`);

  if (process.env.PDP_OPEN !== '0') await openReport(htmlPath).catch(() => undefined);
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
