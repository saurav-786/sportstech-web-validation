export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type PageCategory =
  | 'home' | 'product' | 'category' | 'cart' | 'checkout' | 'login' | 'account'
  | 'blog' | 'support' | 'legal' | 'search' | 'landing' | 'other';

export type FailureClass =
  | 'frontend' | 'backend' | 'content' | 'seo' | 'performance'
  | 'security' | 'accessibility' | 'environment' | 'flaky';

export type FailureCategory =
  | 'Automation Code Issue'
  | 'Real Website Issue'
  | 'Environment/Network Issue'
  | 'Third-party Dependency Issue'
  | 'Performance Issue'
  | 'Accessibility Issue'
  | 'Visual Regression Issue'
  | 'Revenue Risk Issue';

export type ReleaseVerdict = 'ready' | 'ready-with-warning' | 'ready-with-risks' | 'not-ready';

export interface CategoryScores {
  seo: number;
  accessibility: number;
  performance: number;
  security: number;
  stability: number;
  functional: number;
  visual: number;
  health: number;
}

export type PagePosition = 'above-fold' | 'mid-page' | 'near-footer' | 'footer' | 'lazy-loaded' | 'unknown';

export type PageSection =
  | 'hero' | 'product-listing' | 'pricing' | 'cta' | 'checkout' | 'subscription' | 'content';

export interface ScrollMetrics {
  pageUrl: string;
  pageTitle: string;
  totalHeightPx: number;
  viewportHeightPx: number;
  scrollCompleted: boolean;
  scrollDepthPx: number;
  scrollDepthPercent: number;
  bottomReached: boolean;
  infiniteScroll: boolean;
  lazyContentDetected: boolean;
  dynamicSectionsRevealed: number;
  hiddenContentRevealed: number;
  lazyAssetsFound: number;
  imagesLoadedDuringScroll: number;
  newNetworkRequests: number;
  failedNetworkRequests: number;
  failedRenders: number;
  animationIssues: number;
  errorsWhileScrolling: string[];
  screenshotTop: string;
  screenshotBottom: string;
  screenshotFinalTop: string;
  durationMs: number;
}

export interface DeviceProfile {
  name: string;
  width: number;
  height: number;
  isMobile: boolean;
}

export interface DiscoveredPage {
  url: string;
  title: string;
  category?: PageCategory;
  depth: number;
  status?: number;
  contentHash?: string;
  changed?: boolean;
  requiresAuth?: boolean;
  links: string[];
  images: string[];
  forms: number;
  buttons: number;
  inputs: number;
  navigationLabels: string[];
  dynamicElements: {
    accordions: number;
    tabs: number;
    dialogs: number;
    carousels: number;
    videos: number;
    languageSwitchers: number;
  };
}

export interface WebsiteMap {
  baseUrl: string;
  generatedAt: string;
  totalPages: number;
  pages: DiscoveredPage[];
}

export interface ValidationIssue {
  area: 'ui' | 'image' | 'popup' | 'form' | 'responsive' | 'accessibility' | 'seo' | 'performance' | 'security' | 'analytics' | 'heatmap' | 'lighthouse' | 'journey' | 'jserror' | 'conversion' | 'revenue';
  severity: Severity;
  pageUrl: string;
  summary: string;
  evidence?: string;
  suggestedFix?: string;
  businessImpact?: string;
  rootCause?: string;
  failureClass?: FailureClass;
  failureCategory?: FailureCategory;
  codeFixNeeded?: boolean;
  websiteFixNeeded?: boolean;
  confidence?: number;
  pagePosition?: PagePosition;
  pageSection?: PageSection;
  priorityScore?: number;
  duplicateOf?: string;
  signature?: string;
  // --- Revenue Protection extensions (all optional → non-breaking) ---
  funnelStage?: FunnelStage;
  revenueImpact?: RevenueImpact;
  device?: string;
}

// ===========================================================================
// Revenue Protection Platform types (additive — nothing above is changed)
// ===========================================================================

/** Ordered ecommerce funnel stages. Lower index = earlier in the journey. */
export type FunnelStage =
  | 'discovery'
  | 'product-view'
  | 'add-to-cart'
  | 'cart'
  | 'checkout'
  | 'payment'
  | 'order-complete';

export const FUNNEL_ORDER: FunnelStage[] = [
  'discovery', 'product-view', 'add-to-cart', 'cart', 'checkout', 'payment', 'order-complete'
];

/** Revenue-blocking priority. P0 blocks revenue; P3 is cosmetic. */
export type RevenuePriority = 'P0' | 'P1' | 'P2' | 'P3';

/** Quantified business impact attached to a revenue-relevant issue. */
export interface RevenueImpact {
  funnelStage: FunnelStage;
  priority: RevenuePriority;
  usersImpactedPct?: number;     // % of sessions plausibly affected (0–100)
  usersImpactedCount?: number;   // modeled affected sessions / day
  estDailyRevenueEur?: number;   // modeled €/day at risk
  affectedDevices?: string[];
  confidence: number;            // 0–100
  rationale?: string;
}

/** One executed step inside a stateful journey. */
export interface JourneyStep {
  name: string;
  stage: FunnelStage;
  ok: boolean;
  durationMs: number;
  pageUrl?: string;
  detail?: string;
  screenshot?: string;
}

/** Result of running one end-to-end journey on one device. */
export interface JourneyResult {
  name: string;
  device: string;
  browser: string;
  startedAt: string;
  reachedStage: FunnelStage;
  completed: boolean;
  steps: JourneyStep[];
  issues: ValidationIssue[];
  jsErrors: JsErrorRecord[];
  durationMs: number;
}

/** A single captured client-side error, classified and journey-mapped. */
export interface JsErrorRecord {
  type: 'console-error' | 'unhandled-exception' | 'promise-rejection' | 'failed-request' | 'csp-violation';
  message: string;
  pageUrl: string;
  funnelStage?: FunnelStage;
  source?: string;
  count: number;
  firstSeen: string;
}

/** Per-stage funnel metric (rate of sessions that reach the next stage). */
export interface FunnelStageMetric {
  stage: FunnelStage;
  label: string;
  entered: number;          // sessions entering this stage
  continued: number;        // sessions advancing to the next stage
  rate: number;             // continued / entered (0–1)
  dropOffRate: number;      // 1 - rate
  baselineRate?: number;    // expected rate from analytics/config
  healthy: boolean;
  synthetic: boolean;       // true when derived from synthetic journeys vs real analytics
}

export interface FunnelMetrics {
  generatedAt: string;
  source: 'automation-run' | 'analytics' | 'blended' | 'unavailable';
  stages: FunnelStageMetric[];
  overallConversionRate: number;   // observed automation journey completion, not business CR
  biggestDropStage?: FunnelStage;
  conversionHealthScore: number;   // 0–100
}

/** Revenue model inputs (analytics-first, config fallback). */
export interface RevenueAssumptions {
  averageOrderValueEur?: number;
  dailySessions?: number;
  baselineConversionRate?: number;  // 0–1
  source: 'analytics' | 'environment' | 'manual' | 'shopware' | 'blended' | 'unavailable';
  connected: boolean;
  sourceLabel?: string;
  disclaimer: string;
}

/** A deployment event used for regression correlation. */
export interface DeploymentEvent {
  id: string;
  timestamp: string;
  ref?: string;       // git sha / tag
  author?: string;
  description?: string;
  environment?: string;
}

export interface DeploymentCorrelation {
  deployment: DeploymentEvent;
  conversionBefore?: number;
  conversionAfter?: number;
  conversionDeltaPct?: number;
  revenueLossEstimateEur?: number;
  errorSpike?: boolean;
  likelyRootCause?: string;
  confidence: number;            // 0–100
  verdict: 'regression-suspected' | 'no-significant-change' | 'improvement';
}

/** Top-level revenue health roll-up shown on the executive dashboard. */
export interface RevenueHealth {
  generatedAt: string;
  runId: string;
  baseUrl: string;
  pagesDiscovered: number;
  pagesTested: number;
  browsers: string[];
  devices: string[];
  tests?: { total: number; passed: number; failed: number; flaky: number; skipped: number };
  websiteHealthScore: number;
  revenueHealthScore: number;
  revenueRiskScore: number;
  conversionHealthScore: number;
  addToCartSuccessPct: number;
  checkoutSuccessPct: number;
  cartSuccessPct: number;
  paymentSuccessPct: number;
  pdpHealthScore: number;
  mobileHealthScore: number;
  jsErrorRiskScore: number;
  networkRiskScore: number;
  performanceHealthScore?: number;
  accessibilityHealthScore?: number;
  funnel: FunnelMetrics;
  journeys: JourneyResult[];
  topRevenueRisks: ValidationIssue[];
  topTechnicalDefects: ValidationIssue[];
  criticalIncidents: ValidationIssue[];
  deployments: DeploymentCorrelation[];
  assumptions: RevenueAssumptions;
}

/** A single media asset (image/video) discovered on a PDP, with measured bytes. */
export interface MediaAsset {
  kind: 'image' | 'video' | 'source';
  url: string;
  format?: string;            // mp4 / webm / webp / jpg ...
  bytes?: number;             // measured transfer/encoded size, when downloaded
  naturalWidth?: number;
  naturalHeight?: number;
  displayWidth?: number;
  displayHeight?: number;
  durationSec?: number;       // videos
  poster?: string;            // videos
  preload?: string;           // videos
  broken?: boolean;
  notDownloaded?: boolean;    // lazy/preload=none — size not measured
}

/** Media audit of one PDP on one form factor (mobile|desktop). */
export interface MediaPageResult {
  url: string;
  formFactor: 'mobile' | 'desktop';
  device: string;
  images: MediaAsset[];
  videos: MediaAsset[];
  totalImageBytes: number;
  totalVideoBytes: number;
  issues: ValidationIssue[];
}

export interface AnalyticsRecord {
  url: string;
  impressions?: number;
  visits?: number;
  ctr?: number;
  bounceRate?: number;
  conversionRate?: number;
  weight: number;
}

export interface WebVitals {
  fcpMs?: number;
  lcpMs?: number;
  cls?: number;
  tbtMs?: number;
  inpMs?: number;   // Interaction to Next Paint (approximated via event-timing)
  ttfbMs?: number;  // Time To First Byte
  ttiMs?: number;
  domContentLoadedMs?: number;
  loadMs?: number;
  transferKb?: number;
  slowRequests?: Array<{ url: string; durationMs: number }>;
  renderBlocking?: number;
}

export interface AiAnalysis {
  generatedAt: string;
  executiveSummary: string;
  releaseReadiness: { verdict: ReleaseVerdict; rationale: string; blockers?: string[] };
  topRisks: string[];
  recommendedFixes: Array<{ issueSignature: string; fix: string }>;
  recommendedTests: string[];
  duplicateGroups: Array<{ signature: string; count: number; pages: string[] }>;
}

export interface TestFailure {
  test: string;
  browser: string;
  error: string;
  failureClass: FailureClass;
  failureCategory: FailureCategory;
  rootCause: string;
  evidence: string;
  codeFixNeeded: boolean;
  websiteFixNeeded: boolean;
  severity: Severity;
  confidence: number;
  selfHealing: string;
}

export interface RunStats {
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  durationMs: number;
  browsers: string[];
  failures: TestFailure[];
}

export interface TrendSnapshot {
  generatedAt: string;
  pagesTested: number;
  issueCount: number;
  bySeverity: Record<Severity, number>;
  scores: SiteReport['scores'];
}

export interface PageValidationResult {
  url: string;
  browserName: string;
  status?: number;
  passed: boolean;
  screenshot?: string;
  metrics: Record<string, number>;
  issues: ValidationIssue[];
}

export interface SiteReport {
  generatedAt: string;
  baseUrl: string;
  pagesTested: number;
  results: PageValidationResult[];
  issues: ValidationIssue[];
  ai?: AiAnalysis;
  runStats?: RunStats;
  traversals?: ScrollMetrics[];
  analytics?: AnalyticsRecord[];
  trend?: { previous?: TrendSnapshot; current: TrendSnapshot };
  scores: {
    health: number;
    seo: number;
    accessibility: number;
    performance: number;
    security: number;
    stability?: number;
  };
}
