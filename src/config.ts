import { config as loadEnv } from 'dotenv';
import type { DeviceProfile } from './types.js';

loadEnv();

const allDevices: DeviceProfile[] = [
  { name: 'desktop-1920', width: 1920, height: 1080, isMobile: false },
  { name: 'desktop-1440', width: 1440, height: 900, isMobile: false },
  { name: 'ipad-pro', width: 1024, height: 1366, isMobile: false },
  { name: 'ipad-air', width: 820, height: 1180, isMobile: false },
  { name: 'iphone-16-pro', width: 402, height: 874, isMobile: true },
  { name: 'iphone-15', width: 393, height: 852, isMobile: true },
  { name: 'iphone-se', width: 375, height: 667, isMobile: true },
  { name: 'samsung-s25', width: 384, height: 854, isMobile: true },
  { name: 'pixel-9', width: 412, height: 915, isMobile: true }
];

const deviceSet = process.env.DEVICE_SET ?? 'all';

export const appConfig = {
  baseUrl: process.env.BASE_URL ?? 'https://www.sportstech.de/',
  maxPages: Number(process.env.MAX_PAGES ?? 50),
  crawlDepth: Number(process.env.CRAWL_DEPTH ?? 4),
  reportsDir: 'reports',
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 45_000),
  maxLinkChecks: Number(process.env.MAX_LINK_CHECKS ?? 80),
  maxControlChecks: Number(process.env.MAX_CONTROL_CHECKS ?? 30),
  maxTabChecks: Number(process.env.MAX_TAB_CHECKS ?? 8),
  demoMode: process.env.DEMO_MODE === '1',
  quickScan: process.env.QUICK_SCAN === '1',
  devices: deviceSet === 'desktop' ? allDevices.slice(0, 2) : allDevices,
  ignoredPaths: (process.env.IGNORED_PATHS ?? '/cart,/checkout,/account,/wp-admin,/logout')
    .split(',').map((p) => p.trim()).filter(Boolean),
  analyticsDataPath: process.env.ANALYTICS_DATA_PATH ?? 'test-data/analytics.csv',
  historyDir: 'reports/history',
  slowRequestMs: Number(process.env.SLOW_REQUEST_MS ?? 2_000),
  budgets: {
    lcpMs: Number(process.env.BUDGET_LCP_MS ?? 2_500),
    fcpMs: Number(process.env.BUDGET_FCP_MS ?? 1_800),
    cls: Number(process.env.BUDGET_CLS ?? 0.1),
    tbtMs: Number(process.env.BUDGET_TBT_MS ?? 300),
    loadMs: Number(process.env.BUDGET_LOAD_MS ?? 5_000),
    transferKb: Number(process.env.BUDGET_TRANSFER_KB ?? 3_000)
  },
  // AI: 'anthropic' | 'openai' | 'none'. Auto-detects from available keys.
  aiProvider: process.env.AI_PROVIDER
    ?? (process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.OPENAI_API_KEY ? 'openai' : 'none'),
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
  openAiModel: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
  useAi: Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY),

  // --- Revenue Protection configuration (additive) ---
  revenue: {
    // Stop before submitting a real order/payment unless a sandbox is configured.
    paymentMode: (process.env.PAYMENT_MODE ?? 'boundary') as 'boundary' | 'sandbox',
    // Per-stage performance budgets (ms) — funnel-aware, stricter than page budgets.
    inpBudgetMs: Number(process.env.BUDGET_INP_MS ?? 200),
    ttfbBudgetMs: Number(process.env.BUDGET_TTFB_MS ?? 800),
    deploymentsPath: process.env.DEPLOYMENTS_PATH ?? 'test-data/deployments.json',
    seedSearchTerm: process.env.REVENUE_SEED_SEARCH ?? 'laufband',
    // Synthetic, clearly-fake guest checkout data. Boundary mode fills the form to
    // reach the payment step but NEVER places the order. Override via env if needed.
    testGuest: {
      firstName: process.env.REVENUE_TEST_FIRSTNAME ?? 'QA',
      lastName: process.env.REVENUE_TEST_LASTNAME ?? 'Monitor',
      email: process.env.REVENUE_TEST_EMAIL ?? 'qa-monitor+revenue@example.com',
      street: process.env.REVENUE_TEST_STREET ?? 'Teststrasse 1',
      zip: process.env.REVENUE_TEST_ZIP ?? '10115',
      city: process.env.REVENUE_TEST_CITY ?? 'Berlin',
      phone: process.env.REVENUE_TEST_PHONE ?? '030 12345678'
    },
    // PDP media-weight budgets (KB for images, MB for video) per form factor.
    media: {
      imageMaxKbMobile: Number(process.env.MEDIA_IMG_MAX_KB_MOBILE ?? 250),
      imageMaxKbDesktop: Number(process.env.MEDIA_IMG_MAX_KB_DESKTOP ?? 600),
      videoMaxMbMobile: Number(process.env.MEDIA_VIDEO_MAX_MB_MOBILE ?? 6),
      videoMaxMbDesktop: Number(process.env.MEDIA_VIDEO_MAX_MB_DESKTOP ?? 12),
      maxPdps: Number(process.env.MEDIA_MAX_PDPS ?? 6)
    }
  }
};
