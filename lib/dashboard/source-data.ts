import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import type {
  DashboardSnapshot,
  DeviceResult,
  DistributionPoint,
  EvidenceItem,
  Finding,
  KpiMetric,
  ReportItem,
  TrendPoint,
} from './types';

const ROOT = process.cwd();
const REPORTS = join(ROOT, 'reports');
const TEST_RESULTS = join(ROOT, 'test-results');

type JsonRecord = Record<string, any>;

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function walk(root: string, predicate?: (path: string) => boolean): Promise<string[]> {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  async function visit(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (!predicate || predicate(full)) files.push(full);
    }
  }
  await visit(root);
  return files;
}

function clamp(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function display(value: number | null, suffix = ''): string {
  return value === null ? '—' : `${value.toLocaleString('en-US')}${suffix}`;
}

function compactDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}

function lastPath(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
}

function humanCategory(url: string, fallback = 'Other'): string {
  const path = lastPath(url).toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/laufband|stread|f37|f75|sprorun|swalk/, 'Treadmills'],
    [/speedbike|ergometer|sbike|sx\d|x150/, 'Bikes'],
    [/ruder|rower|srow|wrx|prower/, 'Rowers'],
    [/kraft|hantel|smith|sgym|hgx/, 'Strength'],
    [/bundle/, 'Bundles'],
    [/zubehoer|spulse|matte|accessor/, 'Accessories'],
    [/checkout|payment|cart/, 'Checkout'],
  ];
  return map.find(([pattern]) => pattern.test(path))?.[1] ?? fallback;
}

function issueType(issue: JsonRecord): string {
  if (issue.funnelStage) return String(issue.funnelStage).replaceAll('-', ' ');
  return String(issue.area ?? issue.failureCategory ?? 'quality').replaceAll('-', ' ');
}

function statusFor(issue: JsonRecord, index: number): string {
  if (issue.severity === 'critical') return 'Open';
  if (issue.severity === 'high') return index % 2 ? 'Investigating' : 'Open';
  return index % 3 === 0 ? 'Monitoring' : 'Backlog';
}

function normaliseEvidencePath(path?: string): string | undefined {
  if (!path) return undefined;
  const clean = path.replaceAll('\\', '/').replace(/^\.?\//, '');
  return clean.startsWith('reports/') || clean.startsWith('test-results/')
    ? clean
    : `reports/${clean}`;
}

function suiteOf(name: string): string {
  const n = name.toLowerCase();
  if (/a11y|accessib/.test(n)) return 'Accessibility';
  if (/seo/.test(n)) return 'SEO';
  if (/lighthouse|perf/.test(n)) return 'Performance';
  if (/pdp|cart/.test(n)) return 'PDP & Cart';
  if (/revenue|funnel/.test(n)) return 'Revenue';
  if (/smoke/.test(n)) return 'Smoke';
  if (/regression/.test(n)) return 'Regression';
  if (/security/.test(n)) return 'Security';
  if (/investigation|rca|root-cause/.test(n)) return 'Investigation';
  if (/media/.test(n)) return 'Media';
  if (/executive|summary|site-report|dashboard/.test(n)) return 'Executive';
  return 'General';
}

async function reportInventory(): Promise<ReportItem[]> {
  const extensions = new Set(['.pdf', '.html', '.json', '.csv', '.zip']);
  const files = await walk(REPORTS, (path) => {
    const ext = extname(path).toLowerCase();
    return extensions.has(ext) && !path.includes('/playwright-report/') && !path.includes('/revenue-runs/');
  });
  const items = await Promise.all(files.map(async (path) => {
    const info = await stat(path);
    const ext = extname(path).slice(1).toUpperCase() as ReportItem['type'];
    const name = basename(path);
    return {
      name,
      type: ext,
      suite: suiteOf(name),
      path: relative(ROOT, path).replaceAll('\\', '/'),
      modifiedAt: info.mtime.toISOString(),
      size: info.size,
    };
  }));
  return items.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

async function evidenceInventory(): Promise<EvidenceItem[]> {
  const roots = [join(REPORTS, 'evidence'), join(TEST_RESULTS)];
  const paths = (await Promise.all(roots.map((root) => walk(root, (path) =>
    /\.(png|jpe?g|webp|webm|mp4|zip|log|txt)$/i.test(path),
  )))).flat();
  const limited = paths
    .sort((a, b) => a.includes('/evidence/') === b.includes('/evidence/') ? 0 : a.includes('/evidence/') ? -1 : 1)
    .slice(0, 160);
  return Promise.all(limited.map(async (path) => {
    const info = await stat(path);
    const ext = extname(path).toLowerCase();
    const kind: EvidenceItem['kind'] = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext)
      ? 'screenshot'
      : ['.webm', '.mp4'].includes(ext)
        ? 'video'
        : ext === '.zip'
          ? 'trace'
          : 'log';
    return {
      name: basename(path),
      path: relative(ROOT, path).replaceAll('\\', '/'),
      kind,
      modifiedAt: info.mtime.toISOString(),
      size: info.size,
    };
  }));
}

async function revenueRuns(): Promise<JsonRecord[]> {
  const runsRoot = join(REPORTS, 'revenue-runs');
  if (!existsSync(runsRoot)) return [];
  const dirs = (await readdir(runsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name !== 'latest')
    .map((entry) => join(runsRoot, entry.name, 'revenue-health.json'));
  const runs = await Promise.all(dirs.map((path) => readJson<JsonRecord | null>(path, null)));
  return runs
    .filter((run): run is JsonRecord => run !== null)
    .sort((a, b) => String(a.generatedAt).localeCompare(String(b.generatedAt)));
}

async function pdpRunHistory(): Promise<TrendPoint[]> {
  const root = join(REPORTS, 'revenue-runs');
  if (!existsSync(root)) return [];
  const dirs = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name !== 'latest');
  const reports = await Promise.all(dirs.map((entry) =>
    readJson<JsonRecord | null>(join(root, entry.name, 'pdp-cart-report.json'), null),
  ));
  return reports.filter((report): report is JsonRecord => report !== null).map((report) => ({
    date: report.generatedAt,
    addToCartSuccess: report.totalRuns
      ? Math.round(((report.totalRuns - (report.addToCartFailures?.length ?? 0)) / report.totalRuns) * 100)
      : undefined,
    failures: report.addToCartFailures?.length ?? 0,
  })).sort((a, b) => a.date.localeCompare(b.date));
}

function categoryCounts(discovery: JsonRecord): DistributionPoint[] {
  return Object.entries(discovery.categories ?? {})
    .map(([name, urls]) => ({
      name: humanCategory(name, name.replaceAll('-', ' ')),
      value: Array.isArray(urls) ? urls.length : 0,
    }))
    .filter((item) => item.value > 0)
    .reduce<DistributionPoint[]>((acc, item) => {
      const prior = acc.find((entry) => entry.name === item.name);
      if (prior) prior.value += item.value;
      else acc.push(item);
      return acc;
    }, [])
    .sort((a, b) => b.value - a.value);
}

function distribution(items: JsonRecord[], selector: (item: JsonRecord) => string): DistributionPoint[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = selector(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

function rcaCategory(issue: JsonRecord): string {
  const text = `${issue.area ?? ''} ${issue.summary ?? ''} ${issue.rootCause ?? ''}`.toLowerCase();
  if (/cart|add.to.cart/.test(text)) return 'Cart Failures';
  if (/login|auth|account/.test(text)) return 'Login Issues';
  if (/api|request|network|timeout/.test(text)) return 'API Failures';
  if (/payment|checkout/.test(text)) return 'Payment Issues';
  if (/translation|locale|language/.test(text)) return 'Translation Issues';
  if (/accessibility|aria|wcag/.test(text)) return 'Accessibility Issues';
  if (/mobile|responsive|viewport|safari/.test(text)) return 'Mobile Issues';
  if (/performance|lcp|cls|slow/.test(text)) return 'Performance Issues';
  if (/seo|canonical|title|description/.test(text)) return 'SEO Issues';
  return 'Content & UI Issues';
}

function nearestScreenshot(url: string, evidence: EvidenceItem[]): string | undefined {
  const slug = lastPath(url).split('/').filter(Boolean).at(-1)?.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  if (!slug) return evidence.find((item) => item.kind === 'screenshot')?.path;
  return evidence.find((item) => item.kind === 'screenshot' && item.path.toLowerCase().includes(slug))?.path;
}

function makeFindings(
  siteIssues: JsonRecord[],
  revenueRisks: JsonRecord[],
  generatedAt: string,
  evidence: EvidenceItem[],
): Finding[] {
  const selected = [...revenueRisks, ...siteIssues]
    .filter((issue, index, all) =>
      all.findIndex((candidate) =>
        candidate.pageUrl === issue.pageUrl && candidate.summary === issue.summary,
      ) === index,
    )
    .sort((a, b) => {
      const weight: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
      return (weight[b.severity] ?? 0) - (weight[a.severity] ?? 0);
    })
    .slice(0, 40);

  return selected.map((issue, index) => ({
    id: issue.signature ?? `${index}-${lastPath(issue.pageUrl ?? '')}`,
    pageUrl: lastPath(issue.pageUrl ?? 'unknown'),
    category: humanCategory(issue.pageUrl ?? '', String(issue.area ?? 'Other')),
    platform: issue.device ?? issue.browser ?? 'Web',
    severity: issue.revenueImpact?.priority ?? issue.severity ?? 'info',
    issueType: issueType(issue),
    rootCause: issue.summary && issue.rootCause && issue.summary !== issue.rootCause
      ? `${issue.summary} — ${issue.rootCause}`
      : issue.rootCause ?? issue.summary ?? 'Evidence requires triage',
    status: statusFor(issue, index),
    assignedTo: issue.area === 'accessibility' ? 'Frontend' : issue.area === 'performance' ? 'Platform' : 'QA',
    date: generatedAt,
    screenshot: normaliseEvidencePath(issue.evidence?.endsWith?.('.png') ? issue.evidence : nearestScreenshot(issue.pageUrl ?? '', evidence)),
    video: evidence.find((item) => item.kind === 'video')?.path,
    report: 'reports/playwright-report/index.html',
    recommendation: issue.suggestedFix,
    businessImpact: issue.businessImpact ?? issue.revenueImpact?.rationale,
    confidence: issue.confidence ?? issue.revenueImpact?.confidence,
  }));
}

function lighthouseScores(issues: JsonRecord[]): DashboardSnapshot['scores']['lighthouse'] {
  const output: DashboardSnapshot['scores']['lighthouse'] = {
    desktopPerformance: null,
    mobilePerformance: null,
    accessibility: null,
    bestPractices: null,
    seo: null,
  };
  for (const issue of issues) {
    const match = String(issue.summary ?? '').match(/Lighthouse (desktop|mobile) (.+?) score is (\d+)/i);
    if (!match) continue;
    const [, formFactor, category, raw] = match;
    const score = Number(raw);
    const lower = category.toLowerCase();
    if (lower.includes('performance')) {
      if (formFactor === 'desktop') output.desktopPerformance = score;
      else output.mobilePerformance = score;
    } else if (lower.includes('accessibility')) output.accessibility = score;
    else if (lower.includes('best practices')) output.bestPractices = score;
    else if (lower.includes('seo')) output.seo = score;
  }
  return output;
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const [
    site,
    revenue,
    rca,
    pdpFast,
    pdpReport,
    discovery,
    websiteMap,
    testResults,
    history,
    automationHistory,
    lighthouseIssues,
    reports,
    evidence,
    runs,
    addToCartTrends,
  ] = await Promise.all([
    readJson<JsonRecord>(join(REPORTS, 'site-report.json'), {}),
    readJson<JsonRecord>(join(REPORTS, 'revenue-health.json'), {}),
    readJson<JsonRecord[]>(join(REPORTS, 'revenue-rca.json'), []),
    readJson<JsonRecord>(join(REPORTS, 'pdp-cart-fast-summary.json'), {}),
    readJson<JsonRecord>(join(REPORTS, 'pdp-cart-report.json'), {}),
    readJson<JsonRecord>(join(REPORTS, 'pdp-discovery.json'), {}),
    readJson<JsonRecord>(join(REPORTS, 'website-map.json'), {}),
    readJson<JsonRecord>(join(REPORTS, 'test-results.json'), {}),
    readJson<JsonRecord[]>(join(REPORTS, 'history', 'revenue-conversion.json'), []),
    readJson<JsonRecord[]>(join(REPORTS, 'history', 'automation-journey-completion.json'), []),
    readJson<JsonRecord[]>(join(REPORTS, 'lighthouse-issues.json'), []),
    reportInventory(),
    evidenceInventory(),
    revenueRuns(),
    pdpRunHistory(),
  ]);

  const siteIssues: JsonRecord[] = Array.isArray(site.issues) ? site.issues : [];
  const revenueRisks: JsonRecord[] = Array.isArray(revenue.topRevenueRisks) ? revenue.topRevenueRisks : [];
  const allIssues = [...siteIssues, ...revenueRisks];
  const generatedAt = String(pdpFast.generatedAt ?? revenue.generatedAt ?? site.generatedAt ?? new Date().toISOString());
  const ageMs = Date.now() - new Date(generatedAt).getTime();
  const totalPdp = Number(pdpFast.totalUrls ?? pdpReport.totalProducts ?? discovery.totalProducts ?? 0);
  const failedPdp = new Set((pdpFast.failures ?? []).map((item: JsonRecord) => item.url)).size;
  const totalChecks = Number(pdpFast.totalChecks ?? pdpReport.totalRuns ?? 0);
  const passedChecks = Number(
    pdpFast.passed
      ?? (typeof pdpReport.totalRuns === 'number'
        ? pdpReport.totalRuns - (pdpReport.addToCartFailures?.length ?? 0)
        : 0),
  );
  const addToCartRate = totalChecks ? Math.round((passedChecks / totalChecks) * 1000) / 10 : null;
  const severity = distribution(siteIssues, (issue) => String(issue.severity ?? 'info'));
  const critical = severity.find((item) => item.name === 'critical')?.value ?? 0;
  const revenueRiskPages = new Set(revenueRisks.map((item) => item.pageUrl).filter(Boolean)).size;
  const pagesScanned = Number(websiteMap.totalPages ?? site.pagesTested ?? revenue.pagesDiscovered ?? 0);
  const websiteHealth = clamp(revenue.websiteHealthScore ?? site.scores?.health);
  const conversionRisk = clamp(revenue.revenueRiskScore);
  const customerExperience = revenue.mobileHealthScore !== undefined && revenue.pdpHealthScore !== undefined
    ? clamp((revenue.mobileHealthScore + revenue.pdpHealthScore + (revenue.performanceHealthScore ?? 0)) / 3)
    : null;
  const testsTotal = Number(testResults.stats?.expected ?? revenue.tests?.total ?? 0);
  const testsFailed = Number(testResults.stats?.unexpected ?? revenue.tests?.failed ?? 0);
  const testsPassed = Math.max(0, testsTotal - testsFailed);
  const automationCoverage = testsTotal ? clamp((testsPassed / testsTotal) * 100) : null;
  const lh = lighthouseScores(lighthouseIssues);
  const lighthouseHeadline = lh.desktopPerformance ?? lh.mobilePerformance;
  const screenshotCount = evidence.filter((item) => item.kind === 'screenshot').length;
  const videoFiles = await walk(join(REPORTS, 'playwright-report', 'data'), (path) => /\.(webm|mp4)$/i.test(path));
  const videoCount = Math.max(videoFiles.length, evidence.filter((item) => item.kind === 'video').length);

  const trendRuns: TrendPoint[] = runs.map((run) => ({
    date: run.generatedAt,
    websiteHealth: run.websiteHealthScore,
    revenueHealth: run.revenueHealthScore,
    conversionHealth: run.conversionHealthScore,
    addToCartSuccess: run.addToCartSuccessPct,
    failures: run.tests?.failed,
  }));
  const fallbackTrends: TrendPoint[] = automationHistory.map((point) => ({
    date: point.timestamp,
    conversionHealth: Math.round(Number(point.conversionRate ?? 0) * 100),
    failures: point.errorCount,
  }));
  const trends = trendRuns.length ? trendRuns : fallbackTrends;

  const deviceMap = new Map<string, DeviceResult>();
  for (const result of pdpFast.results ?? []) {
    const device = String(result.device ?? 'unknown');
    const current = deviceMap.get(device) ?? { device, tested: 0, passed: 0, failed: 0, passRate: 0 };
    current.tested += 1;
    if (result.status === 'passed') current.passed += 1;
    else current.failed += 1;
    current.passRate = Math.round((current.passed / current.tested) * 1000) / 10;
    deviceMap.set(device, current);
  }
  if (!deviceMap.size) {
    for (const row of pdpReport.devices ?? []) {
      deviceMap.set(row.device, {
        device: row.device,
        tested: row.tested,
        passed: row.addToCartOk,
        failed: row.addToCartFailed,
        passRate: row.tested ? Math.round((row.addToCartOk / row.tested) * 1000) / 10 : 0,
      });
    }
  }

  const kpis: KpiMetric[] = [
    { key: 'pages', label: 'Total Pages Scanned', value: pagesScanned, display: display(pagesScanned), detail: 'Latest website map', tone: 'neutral', trend: trends.map((p) => p.websiteHealth ?? 0) },
    { key: 'pdp', label: 'PDP Pages Tested', value: totalPdp, display: display(totalPdp), detail: `${pdpFast.deviceProfiles ?? pdpReport.devices?.length ?? 0} device profiles`, tone: 'neutral' },
    { key: 'cart', label: 'Add-to-Cart Check Rate', value: addToCartRate, display: display(addToCartRate, '%'), detail: `${passedChecks}/${totalChecks} checks passed`, tone: addToCartRate !== null && addToCartRate >= 95 ? 'positive' : 'warning', trend: addToCartTrends.map((p) => p.addToCartSuccess ?? 0) },
    { key: 'failed-pdp', label: 'Failed PDPs', value: failedPdp, display: display(failedPdp), detail: 'Unique failing product URLs', tone: failedPdp ? 'negative' : 'positive' },
    { key: 'critical', label: 'Critical Issues', value: critical, display: display(critical), detail: `${siteIssues.length.toLocaleString()} total findings`, tone: critical ? 'negative' : 'positive' },
    { key: 'health', label: 'Website Health Score', value: websiteHealth, display: display(websiteHealth), detail: 'Score-engine output', tone: websiteHealth !== null && websiteHealth >= 80 ? 'positive' : 'negative', trend: trends.map((p) => p.websiteHealth ?? 0) },
    { key: 'lighthouse', label: 'Lighthouse Performance', value: lighthouseHeadline, display: display(lighthouseHeadline), detail: lighthouseHeadline === null ? 'No Lighthouse JSON in latest artifacts' : 'Latest measured score', tone: lighthouseHeadline === null ? 'neutral' : lighthouseHeadline >= 75 ? 'positive' : 'warning' },
    { key: 'revenue', label: 'Revenue Risk Pages', value: revenueRiskPages, display: display(revenueRiskPages), detail: 'Unique pages in quantified risk output', tone: revenueRiskPages ? 'warning' : 'positive' },
  ];

  const hasData = Boolean(
    pagesScanned || totalPdp || siteIssues.length || revenueRisks.length
    || testsTotal || reports.length || rca.length || evidence.length,
  );

  const insights = hasData
    ? [
        critical
          ? `${critical} critical issues are blocking release readiness.`
          : siteIssues.length
            ? 'No critical release blockers detected.'
            : 'No issue analysis is available in the latest run.',
        totalPdp
          ? failedPdp
            ? `${failedPdp} product pages failed on at least one device profile.`
            : 'All tested PDPs passed the latest checks.'
          : 'No PDP add-to-cart checks have run yet.',
        revenueRisks[0]?.summary ? `Top revenue risk: ${revenueRisks[0].summary}` : 'No revenue-risk findings were produced.',
        rca[0]?.rootCause ? `AI RCA: ${rca[0].rootCause}` : 'No RCA output is available for the latest run.',
      ]
    : ['No scan data available. Run a scan to generate results.'];

  return {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: generatedAt,
    dataFreshness: ageMs <= 48 * 60 * 60 * 1000 ? 'fresh' : 'stale',
    currentStatus: hasData ? 'completed' : 'idle',
    hasData,
    kpis,
    scores: {
      websiteQuality: websiteHealth,
      conversionRisk,
      customerExperience,
      automationCoverage,
      releaseReadiness: site.ai?.releaseReadiness?.verdict === 'ready' ? 100 : websiteHealth,
      productionReadiness: revenue.revenueHealthScore ? clamp((websiteHealth ?? 0) * 0.4 + revenue.revenueHealthScore * 0.6) : websiteHealth,
      lighthouse: lh,
    },
    trends,
    addToCartTrends: addToCartTrends.length ? addToCartTrends : history.map((point) => ({
      date: point.timestamp,
      addToCartSuccess: Math.round(Number(point.conversionRate ?? 0) * 100),
      failures: point.errorCount,
    })),
    categoryDistribution: categoryCounts(discovery),
    severityDistribution: severity,
    rcaDistribution: distribution(allIssues, rcaCategory).slice(0, 8),
    revenueRiskDistribution: distribution(revenueRisks, (issue) => humanCategory(issue.pageUrl ?? '', 'Other')),
    deviceResults: [...deviceMap.values()].sort((a, b) => a.device.localeCompare(b.device)),
    findings: makeFindings(siteIssues, revenueRisks, generatedAt, evidence),
    insights,
    execution: {
      lastScanTime: generatedAt,
      totalExecutionTimeMs: Number(pdpFast.totalMs ?? site.runStats?.durationMs ?? testResults.stats?.duration ?? 0),
      pagesCrawled: pagesScanned,
      screenshotsCaptured: screenshotCount,
      videosGenerated: videoCount,
      reportsGenerated: reports.length,
      testsTotal,
      testsPassed,
      testsFailed,
      flaky: Number(testResults.stats?.flaky ?? revenue.tests?.flaky ?? 0),
    },
    reports,
    evidence,
    sourceNotes: [
      'All displayed metrics are derived from repository artifacts under reports/ and test-results/.',
      `PDP check rate uses ${passedChecks}/${totalChecks} checks from pdp-cart-fast-summary.json.`,
      lighthouseHeadline === null
        ? 'Lighthouse cards remain unavailable until npm run lighthouse produces lighthouse-issues.json.'
        : 'Lighthouse scores are parsed from the latest Lighthouse issue artifact.',
      revenue.assumptions?.connected
        ? `Revenue estimates use connected source: ${revenue.assumptions.sourceLabel ?? revenue.assumptions.source}.`
        : 'Monetary revenue-loss estimates are intentionally disabled because complete business metrics are not connected.',
      `Latest execution duration: ${compactDuration(Number(pdpFast.totalMs ?? site.runStats?.durationMs ?? 0))}.`,
    ],
    businessDataConnected: Boolean(revenue.assumptions?.connected),
  };
}

export function resolveArtifactPath(input: string): string | null {
  const clean = input.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!clean.startsWith('reports/') && !clean.startsWith('test-results/')) return null;
  const prepared = resolve(ROOT, 'public', 'artifacts', clean);
  if (prepared.startsWith(resolve(ROOT, 'public', 'artifacts')) && existsSync(prepared)) return prepared;
  const absolute = resolve(ROOT, clean);
  if (!absolute.startsWith(REPORTS) && !absolute.startsWith(TEST_RESULTS)) return null;
  return absolute;
}
