/**
 * runInvestigation.ts — builds the consolidated incident investigation report
 * from the artifacts produced by the @revenue and @media suites.
 *
 *   npm run investigate            # aggregate existing run artifacts → report
 *   npm run investigate:full       # run journeys (matrix) + media, then aggregate
 *
 * Reads reports/journeys/*.json + reports/media/media-results.json, rebuilds the
 * revenue-health / RCA / deployment-correlation layers, evaluates the incident
 * hypotheses, and writes reports/investigation-report.html + .md.
 */
import { existsSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appConfig } from '../config.js';
import type { JourneyResult, MediaPageResult, SiteReport, ValidationIssue, WebsiteMap } from '../types.js';
import { loadAnalytics } from '../analytics/importAnalytics.js';
import { loadDeployments } from '../deploy/markers.js';
import { buildRevenueHealth } from '../revenue/revenueHealth.js';
import { dropOffIssues } from '../conversion/dropoff.js';
import { analyzeJourneys } from '../ai/evidenceRca.js';
import { buildInvestigationHtml, buildInvestigationMarkdown, type InvestigationInput } from '../reports/investigationReport.js';
import { ensureDir, readJson } from '../utils/fs.js';
import type { ConversionPoint } from '../deploy/correlate.js';
import { createLogger } from '../utils/logger.js';
import { renderHtmlReportToPdf } from '../reports/pdf.js';
import { loadBusinessMetrics } from '../revenue/businessData.js';
import { resolveRevenueRunDir } from '../revenue/runArtifacts.js';

const log = createLogger('investigation');
const INCIDENT_DATE = process.env.INCIDENT_DATE ?? '2026-06-11';

async function loadJsonDir<T>(dir: string): Promise<T[]> {
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  const out: T[] = [];
  for (const f of files) { try { out.push(await readJson<T>(join(dir, f))); } catch { /* skip */ } }
  return out;
}

async function loadConversionHistory(): Promise<ConversionPoint[]> {
  const path = process.env.REVENUE_CONVERSION_HISTORY_PATH;
  if (path && existsSync(path)) { try { return await readJson<ConversionPoint[]>(path); } catch { /* */ } }
  return [];
}

async function main(): Promise<void> {
  const runDir = await resolveRevenueRunDir();
  const journeys = await loadJsonDir<JourneyResult>(join(runDir, 'journeys'));
  const mediaResults = existsSync(join(runDir, 'media', 'media-results.json'))
    ? await readJson<MediaPageResult[]>(join(runDir, 'media', 'media-results.json')).catch(() => [])
    : [];

  if (journeys.length === 0) {
    log.warn('No journey artifacts found. Run `npm run test:revenue:matrix` (and `npm run test:media`) first.');
  }

  const analytics = await loadAnalytics().catch(() => []);
  const businessMetrics = await loadBusinessMetrics().catch(() => undefined);
  const deployments = await loadDeployments().catch(() => []);
  const conversionHistory = await loadConversionHistory();
  const siteReport = existsSync(join(appConfig.reportsDir, 'site-report.json'))
    ? await readJson<SiteReport>(join(appConfig.reportsDir, 'site-report.json')).catch(() => undefined)
    : undefined;
  const websiteMap = existsSync(join(appConfig.reportsDir, 'website-map.json'))
    ? await readJson<WebsiteMap>(join(appConfig.reportsDir, 'website-map.json')).catch(() => undefined)
    : undefined;

  const health = buildRevenueHealth({
    runId: runDir.split('/').pop(), journeys, analytics, businessMetrics, deployments, conversionHistory, siteReport, websiteMap,
  });
  const rca = await analyzeJourneys(journeys);

  // Full issue set for hypothesis evaluation: journeys + funnel drop-offs + media.
  const allIssues: ValidationIssue[] = [
    ...journeys.flatMap((j) => j.issues),
    ...dropOffIssues(health.funnel),
    ...mediaResults.flatMap((m) => m.issues),
  ];

  const input: InvestigationInput = { incidentDate: INCIDENT_DATE, health, journeys, mediaResults, rca, allIssues };

  await ensureDir(appConfig.reportsDir);
  const htmlPath = join(appConfig.reportsDir, 'investigation-report.html');
  const mdPath = join(appConfig.reportsDir, 'investigation-report.md');
  await writeFile(htmlPath, buildInvestigationHtml(input), 'utf8');
  await writeFile(mdPath, buildInvestigationMarkdown(input), 'utf8');
  const pdfPath = await renderHtmlReportToPdf({
    inputHtml: htmlPath,
    outputPdf: join(appConfig.reportsDir, 'investigation-report.pdf'),
    title: 'Revenue Incident Investigation',
  });

  log.info(`Investigation report: ${htmlPath}`);
  log.info(`Markdown summary:      ${mdPath}`);
  log.info(`Downloadable PDF:      ${pdfPath}`);
  log.info(`Revenue Health ${health.revenueHealthScore}/100 · ${allIssues.filter((i) => i.severity === 'critical').length} critical · ${allIssues.filter((i) => i.severity === 'high').length} high · ${journeys.length} device run(s)`);
}

main().catch((err) => { log.error(err instanceof Error ? err.message : String(err)); process.exitCode = 1; });
