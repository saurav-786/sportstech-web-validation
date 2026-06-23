export type MetricValue = number | null;

export interface KpiMetric {
  key: string;
  label: string;
  value: MetricValue;
  display: string;
  detail: string;
  tone: 'positive' | 'negative' | 'neutral' | 'warning';
  trend?: number[];
}

export interface TrendPoint {
  date: string;
  websiteHealth?: number;
  revenueHealth?: number;
  conversionHealth?: number;
  addToCartSuccess?: number;
  failures?: number;
}

export interface DistributionPoint {
  name: string;
  value: number;
}

export interface Finding {
  id: string;
  pageUrl: string;
  category: string;
  platform: string;
  severity: string;
  issueType: string;
  rootCause: string;
  status: string;
  assignedTo: string;
  date: string;
  screenshot?: string;
  video?: string;
  report?: string;
  recommendation?: string;
  businessImpact?: string;
  confidence?: number;
}

export interface ReportItem {
  name: string;
  type: 'PDF' | 'HTML' | 'JSON' | 'CSV' | 'ZIP';
  path: string;
  modifiedAt: string;
  size: number;
}

export interface EvidenceItem {
  name: string;
  path: string;
  kind: 'screenshot' | 'video' | 'trace' | 'log';
  modifiedAt: string;
  size: number;
}

export interface DeviceResult {
  device: string;
  tested: number;
  passed: number;
  failed: number;
  passRate: number;
}

export interface DashboardSnapshot {
  generatedAt: string;
  sourceGeneratedAt: string;
  dataFreshness: 'fresh' | 'stale';
  currentStatus: 'idle' | 'running' | 'failed' | 'completed';
  kpis: KpiMetric[];
  scores: {
    websiteQuality: number | null;
    conversionRisk: number | null;
    customerExperience: number | null;
    automationCoverage: number | null;
    releaseReadiness: number | null;
    productionReadiness: number | null;
    lighthouse: {
      desktopPerformance: number | null;
      mobilePerformance: number | null;
      accessibility: number | null;
      bestPractices: number | null;
      seo: number | null;
    };
  };
  trends: TrendPoint[];
  addToCartTrends: TrendPoint[];
  categoryDistribution: DistributionPoint[];
  severityDistribution: DistributionPoint[];
  rcaDistribution: DistributionPoint[];
  revenueRiskDistribution: DistributionPoint[];
  deviceResults: DeviceResult[];
  findings: Finding[];
  insights: string[];
  execution: {
    lastScanTime: string;
    totalExecutionTimeMs: number;
    pagesCrawled: number;
    screenshotsCaptured: number;
    videosGenerated: number;
    reportsGenerated: number;
    testsTotal: number;
    testsPassed: number;
    testsFailed: number;
    flaky: number;
  };
  reports: ReportItem[];
  evidence: EvidenceItem[];
  sourceNotes: string[];
  businessDataConnected: boolean;
}
