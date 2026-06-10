export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type PageCategory =
  | 'home' | 'product' | 'category' | 'cart' | 'checkout' | 'login' | 'account'
  | 'blog' | 'support' | 'legal' | 'search' | 'landing' | 'other';

export type FailureClass =
  | 'frontend' | 'backend' | 'content' | 'seo' | 'performance'
  | 'security' | 'accessibility' | 'environment' | 'flaky';

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
  area: 'ui' | 'image' | 'popup' | 'form' | 'responsive' | 'accessibility' | 'seo' | 'performance' | 'security' | 'analytics' | 'heatmap' | 'lighthouse';
  severity: Severity;
  pageUrl: string;
  summary: string;
  evidence?: string;
  suggestedFix?: string;
  businessImpact?: string;
  rootCause?: string;
  failureClass?: FailureClass;
  confidence?: number;
  pagePosition?: PagePosition;
  pageSection?: PageSection;
  priorityScore?: number;
  duplicateOf?: string;
  signature?: string;
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
