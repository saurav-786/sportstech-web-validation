/**
 * runRevenueReport.ts — aggregates the @revenue suite output into the executive
 * Revenue Protection dashboard + JSON + AI RCA. Run after the Playwright
 * @revenue suite (which writes reports/journeys/*.json).
 *
 *   npm run revenue:report
 *
 * Pipeline: journeys → analytics-aware assumptions → funnel/conversion → revenue
 * impact → deployment correlation → AI evidence RCA → dashboard. Degrades
 * gracefully: missing analytics/deployments/AI key all fall back safely.
 */
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { appConfig } from '../config.js';
import type { JourneyResult, SiteReport, WebsiteMap } from '../types.js';
import { loadAnalytics } from '../analytics/importAnalytics.js';
import { loadDeployments } from '../deploy/markers.js';
import { buildRevenueHealth } from '../revenue/revenueHealth.js';
import { analyzeJourneys } from '../ai/evidenceRca.js';
import { buildRevenueDashboardHtml } from '../reports/revenueDashboard.js';
import { ensureDir, readJson, writeJson } from '../utils/fs.js';
import { writeFile } from 'node:fs/promises';
import { createLogger } from '../utils/logger.js';
import type { ConversionPoint } from '../deploy/correlate.js';
import { renderHtmlReportToPdf } from '../reports/pdf.js';
import { loadBusinessMetrics } from '../revenue/businessData.js';
import { resolveRevenueRunDir } from '../revenue/runArtifacts.js';

const log = createLogger('revenue-report');

async function loadJourneys(dir: string): Promise<JourneyResult[]> {
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  const out: JourneyResult[] = [];
  for (const f of files) {
    try { out.push(await readJson<JourneyResult>(join(dir, f))); } catch { /* skip malformed */ }
  }
  return out;
}

/** Persist automation-run journey completion separately from real business CR. */
async function updateAutomationHistory(rate: number, errorCount: number): Promise<void> {
  const path = join(appConfig.historyDir, 'automation-journey-completion.json');
  let history: ConversionPoint[] = [];
  if (existsSync(path)) {
    try { history = await readJson<ConversionPoint[]>(path); } catch { history = []; }
  }
  history.push({ timestamp: new Date().toISOString(), conversionRate: rate, errorCount });
  history = history.slice(-100); // keep last 100 points
  await writeJson(path, history);
}

async function loadBusinessConversionHistory(): Promise<ConversionPoint[]> {
  const path = process.env.REVENUE_CONVERSION_HISTORY_PATH;
  if (!path || !existsSync(path)) return [];
  return readJson<ConversionPoint[]>(path).catch(() => []);
}

async function main(): Promise<void> {
  const runDir = await resolveRevenueRunDir();
  const journeysDir = join(runDir, 'journeys');
  const journeys = await loadJourneys(journeysDir);
  if (journeys.length === 0) {
    log.warn(`No journey results in ${journeysDir}. Run the @revenue suite first (npm run test:revenue).`);
  }

  const analytics = await loadAnalytics().catch(() => []);
  const businessMetrics = await loadBusinessMetrics().catch((error: Error) => {
    log.warn(`Business metrics unavailable: ${error.message}`);
    return undefined;
  });
  const deployments = await loadDeployments().catch(() => []);
  const siteReportPath = join(appConfig.reportsDir, 'site-report.json');
  const websiteMapPath = join(appConfig.reportsDir, 'website-map.json');
  const siteReport = existsSync(siteReportPath)
    ? await readJson<SiteReport>(siteReportPath).catch(() => undefined)
    : undefined;
  const websiteMap = existsSync(websiteMapPath)
    ? await readJson<WebsiteMap>(websiteMapPath).catch(() => undefined)
    : undefined;

  // Automation completion history is operational telemetry, never business CR.
  const provisional = buildRevenueHealth({ journeys, analytics, businessMetrics, siteReport, websiteMap });
  const errorCount = journeys.reduce((s, j) => s + j.jsErrors.length, 0);
  await updateAutomationHistory(provisional.funnel.overallConversionRate, errorCount);
  const conversionHistory = await loadBusinessConversionHistory();

  const health = buildRevenueHealth({
    runId: runDir.split('/').pop(), journeys, analytics, businessMetrics, deployments, conversionHistory, siteReport, websiteMap,
  });
  const rca = await analyzeJourneys(journeys);

  await ensureDir(appConfig.reportsDir);
  await writeJson(join(appConfig.reportsDir, 'revenue-health.json'), health);
  await writeJson(join(appConfig.reportsDir, 'revenue-rca.json'), rca);
  await writeJson(join(runDir, 'revenue-health.json'), health);
  await writeJson(join(runDir, 'revenue-rca.json'), rca);
  const html = buildRevenueDashboardHtml(health, rca);
  const dashPath = join(appConfig.reportsDir, 'revenue-dashboard.html');
  await writeFile(dashPath, html, 'utf8');
  const pdfPath = await renderHtmlReportToPdf({
    inputHtml: dashPath,
    outputPdf: join(appConfig.reportsDir, 'revenue-report.pdf'),
    title: 'Revenue Protection Report',
    preserveScreenTheme: true, // PDF mirrors the dark on-screen Revenue dashboard.
  });

  log.info(`Revenue Health: ${health.revenueHealthScore}/100 · Conversion Health: ${health.conversionHealthScore}/100`);
  log.info(`Checkout ${health.checkoutSuccessPct}% · Cart ${health.cartSuccessPct}% · Payment ${health.paymentSuccessPct}% · Mobile ${health.mobileHealthScore}`);
  log.info(`Top revenue risks: ${health.topRevenueRisks.length} · Critical incidents: ${health.criticalIncidents.length}`);
  log.info(health.assumptions.disclaimer);
  log.info(`Dashboard written: ${dashPath}`);
  log.info(`Downloadable PDF: ${pdfPath}`);
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
