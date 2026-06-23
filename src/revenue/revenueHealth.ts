/**
 * revenueHealth.ts — Phase 7/9 aggregator. Turns journey results + analytics +
 * deployments + conversion history into a single RevenueHealth roll-up consumed
 * by the executive dashboard. Pure (no I/O) so it is unit-testable.
 */
import {
  FUNNEL_ORDER,
  type AnalyticsRecord,
  type DeploymentCorrelation,
  type DeploymentEvent,
  type FunnelStage,
  type JourneyResult,
  type RevenueHealth,
  type RevenueAssumptions,
  type SiteReport,
  type ValidationIssue,
  type WebsiteMap,
} from '../types.js';
import { buildFunnel } from '../conversion/funnelModel.js';
import { dropOffIssues } from '../conversion/dropoff.js';
import { resolveAssumptions } from './assumptions.js';
import { enrichWithRevenueImpact, topRevenueRisks } from './impactEngine.js';
import { correlateDeployments, type ConversionPoint } from '../deploy/correlate.js';
import { classifyValidationIssue } from '../ai/failureClassification.js';

/**
 * % of journeys that, having reached the PRIOR stage, successfully reached
 * `stage`. Using the prior stage as denominator works in boundary-payment mode
 * (where 'payment' is the terminal success state and 'order-complete' is never
 * observed): paymentSuccess = reached payment / reached checkout.
 */
function stageSuccessPct(journeys: JourneyResult[], stage: FunnelStage): number {
  const idx = FUNNEL_ORDER.indexOf(stage);
  const priorIdx = Math.max(0, idx - 1);
  const reachedPrior = journeys.filter((j) => FUNNEL_ORDER.indexOf(j.reachedStage) >= priorIdx);
  if (reachedPrior.length === 0) return 100;
  const reachedStage = reachedPrior.filter((j) => FUNNEL_ORDER.indexOf(j.reachedStage) >= idx);
  return Math.round((reachedStage.length / reachedPrior.length) * 100);
}

function mobileHealth(journeys: JourneyResult[]): number {
  const mobile = journeys.filter((j) => /iphone|pixel|galaxy|android|samsung|mobile/i.test(j.device));
  if (mobile.length === 0) return 100;
  const ok = mobile.filter((j) => FUNNEL_ORDER.indexOf(j.reachedStage) >= FUNNEL_ORDER.indexOf('checkout'));
  return Math.round((ok.length / mobile.length) * 100);
}

export interface RevenueHealthInputs {
  runId?: string;
  journeys: JourneyResult[];
  analytics?: AnalyticsRecord[];
  businessMetrics?: RevenueAssumptions;
  deployments?: DeploymentEvent[];
  conversionHistory?: ConversionPoint[];
  siteReport?: SiteReport;
  websiteMap?: WebsiteMap;
}

export function buildRevenueHealth(inputs: RevenueHealthInputs): RevenueHealth {
  const journeys = inputs.journeys;
  const analytics = inputs.analytics ?? [];
  const assumptions = resolveAssumptions(analytics, inputs.businessMetrics);
  const deviceCount = new Set(journeys.map((j) => j.device)).size || 1;

  const funnel = buildFunnel(journeys, analytics);

  // Gather all issues: journey issues + funnel drop-off issues, then quantify.
  const rawIssues: ValidationIssue[] = [
    ...journeys.flatMap((j) => j.issues),
    ...dropOffIssues(funnel),
  ].map((issue) => ({ ...issue, ...classifyValidationIssue(issue) }));
  const issues = enrichWithRevenueImpact(rawIssues, { assumptions, totalDeviceCount: deviceCount });

  const moneyStageErrorsAfter = issues.filter((i) =>
    (i.area === 'jserror' || i.area === 'journey') &&
    (i.funnelStage === 'checkout' || i.funnelStage === 'payment'));

  const deployments: DeploymentCorrelation[] = (assumptions.connected
      && assumptions.averageOrderValueEur !== undefined
      && assumptions.dailySessions !== undefined
      && inputs.deployments?.length
      && inputs.conversionHistory?.length)
    ? correlateDeployments({
        deployments: inputs.deployments,
        history: inputs.conversionHistory,
        averageOrderValueEur: assumptions.averageOrderValueEur,
        dailySessions: assumptions.dailySessions,
        moneyStageErrorsAfter,
      })
    : [];

  // Performance health proxy from any perf issues attached to journeys.
  const earliestJourney = journeys.map((j) => Date.parse(j.startedAt)).filter(Number.isFinite).sort()[0];
  const siteReportCurrent = !!inputs.siteReport && (!earliestJourney || Date.parse(inputs.siteReport.generatedAt) >= earliestJourney - 60_000);
  const externalIssues = siteReportCurrent ? (inputs.siteReport?.issues ?? []) : [];
  const combinedIssues = [...issues, ...externalIssues];
  const performanceIssues = combinedIssues.filter((i) => i.area === 'performance' || i.area === 'lighthouse');
  const accessibilityIssues = combinedIssues.filter((i) => i.area === 'accessibility');
  const performanceHealthScore = performanceIssues.length || siteReportCurrent
    ? (siteReportCurrent ? inputs.siteReport?.scores.performance : scoreRisk(performanceIssues))
    : undefined;
  const accessibilityHealthScore = siteReportCurrent
    ? inputs.siteReport?.scores.accessibility
    : accessibilityIssues.length ? scoreRisk(accessibilityIssues) : undefined;
  const addToCartSuccessPct = namedStepSuccess(journeys, /^Add to Cart$/i);
  const checkoutSuccessPct = stageSuccessPct(journeys, 'checkout');
  const cartSuccessPct = stageSuccessPct(journeys, 'cart');
  const paymentSuccessPct = stageSuccessPct(journeys, 'payment');
  const mobileHealthScore = mobileHealth(journeys);
  const pdpHealthScore = namedStepSuccess(journeys, /Product image present|Price visible/i);
  const jsRecords = journeys.flatMap((j) => j.jsErrors);
  const firstPartyRecords = jsRecords.filter((e) => !isThirdPartyOrBrowserNoise(e.message));
  const jsErrorRiskScore = riskFromCount(firstPartyRecords.filter((e) => e.type !== 'failed-request').length);
  const networkRiskScore = riskFromCount(firstPartyRecords.filter((e) => e.type === 'failed-request').length);
  const allSteps = journeys.flatMap((j) => j.steps);
  const stepHealth = allSteps.length ? Math.round((allSteps.filter((s) => s.ok).length / allSteps.length) * 100) : 100;
  const websiteHealthScore = siteReportCurrent
    ? inputs.siteReport!.scores.health
    : Math.round(stepHealth * 0.65 + jsErrorRiskScore * 0.2 + networkRiskScore * 0.15);

  // Revenue Health Score: blend of conversion health, money-stage success, mobile, perf,
  // with a hard penalty for any P0 revenue risk.
  const p0Count = issues.filter((i) => i.revenueImpact?.priority === 'P0').length;
  const baseBlend = Math.round(
    funnel.conversionHealthScore * 0.30 +
    checkoutSuccessPct * 0.20 +
    paymentSuccessPct * 0.15 +
    cartSuccessPct * 0.10 +
    mobileHealthScore * 0.15 +
    (performanceHealthScore ?? funnel.conversionHealthScore) * 0.10
  );
  const revenueHealthScore = Math.max(0, Math.min(100, Math.round(
    baseBlend * 0.7
    + pdpHealthScore * 0.1
    + jsErrorRiskScore * 0.075
    + networkRiskScore * 0.075
    + (accessibilityHealthScore ?? baseBlend) * 0.05
  ) - Math.min(35, p0Count * 10)));
  const revenueRiskScore = 100 - revenueHealthScore;
  const runStats = siteReportCurrent ? inputs.siteReport?.runStats : undefined;
  const devices = [...new Set(journeys.map((j) => j.device))].sort();
  const browsers = [...new Set([
    ...journeys.map((j) => j.browser),
    ...(runStats?.browsers ?? []),
  ])].sort();

  return {
    generatedAt: new Date().toISOString(),
    runId: inputs.runId ?? 'unknown',
    baseUrl: inputs.siteReport?.baseUrl ?? inputs.websiteMap?.baseUrl ?? 'https://www.sportstech.de/',
    pagesDiscovered: inputs.websiteMap?.totalPages ?? 0,
    pagesTested: new Set(journeys.flatMap((j) => j.steps.map((s) => s.pageUrl).filter(Boolean))).size,
    browsers,
    devices,
    tests: runStats ? {
      total: runStats.total,
      passed: runStats.passed,
      failed: runStats.failed,
      flaky: runStats.flaky,
      skipped: runStats.skipped,
    } : {
      total: journeys.length,
      passed: journeys.filter((j) => j.completed).length,
      failed: journeys.filter((j) => !j.completed).length,
      flaky: 0,
      skipped: 0,
    },
    websiteHealthScore,
    revenueHealthScore,
    revenueRiskScore,
    conversionHealthScore: funnel.conversionHealthScore,
    addToCartSuccessPct,
    checkoutSuccessPct,
    cartSuccessPct,
    paymentSuccessPct,
    pdpHealthScore,
    mobileHealthScore,
    jsErrorRiskScore,
    networkRiskScore,
    performanceHealthScore,
    accessibilityHealthScore,
    funnel,
    journeys,
    topRevenueRisks: topRevenueRisks(issues, 10),
    topTechnicalDefects: [...combinedIssues]
      .filter((i) => i.severity !== 'info')
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
      .slice(0, 10),
    criticalIncidents: issues.filter((i) => i.severity === 'critical'),
    deployments,
    assumptions,
  };
}

function namedStepSuccess(journeys: JourneyResult[], pattern: RegExp): number {
  const steps = journeys.flatMap((j) => j.steps.filter((s) => pattern.test(s.name)));
  if (!steps.length) return 100;
  return Math.round((steps.filter((s) => s.ok).length / steps.length) * 100);
}

function scoreRisk(issues: ValidationIssue[]): number {
  const penalty = issues.reduce((sum, issue) =>
    sum + (issue.severity === 'critical' ? 20 : issue.severity === 'high' ? 8 : issue.severity === 'medium' ? 3 : issue.severity === 'low' ? 1 : 0), 0);
  return Math.max(0, 100 - penalty);
}

function riskFromCount(count: number): number {
  return Math.max(0, Math.round(100 - Math.min(100, count * 4)));
}

function severityRank(severity: ValidationIssue['severity']): number {
  return ({ critical: 5, high: 4, medium: 3, low: 2, info: 1 })[severity];
}

function isThirdPartyOrBrowserNoise(message: string): boolean {
  return /fontawesome|tiktok|zendesk|doofinder|klaviyo|bugsnag|alhena|cloudfront|jsdelivr|facebook|doubleclick|google-analytics|cookie .*rejected|play\(\) request was interrupted|media resource was aborted|ns_error_parsed_data_cached/i.test(message);
}
