import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv();

const requestedBrowsers = (process.env.BROWSERS ?? 'chromium,firefox,webkit')
  .split(',')
  .map((browser) => browser.trim())
  .filter(Boolean);

const browserProjects = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } }
].filter((project) => requestedBrowsers.includes(project.name));

// Phase 5 — Revenue device matrix. Opt-in via REVENUE_MATRIX=1 so existing
// suites keep their default desktop browser projects untouched. Names double as
// the device labels recorded on every JourneyResult / ValidationIssue.
const revenueMatrixProjects = process.env.REVENUE_MATRIX === '1'
  ? [
      { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
      { name: 'desktop-firefox', use: { ...devices['Desktop Firefox'] } },
      { name: 'desktop-edge', use: { ...devices['Desktop Edge'] } },
      { name: 'desktop-safari', use: { ...devices['Desktop Safari'] } },
      { name: 'iphone-15', use: { ...devices['iPhone 15'] } },
      { name: 'iphone-se', use: { ...devices['iPhone SE'] } },
      { name: 'pixel-7-android', use: { ...devices['Pixel 7'] } },
      { name: 'galaxy-s9-android', use: { ...devices['Galaxy S9+'] } },
      { name: 'samsung-internet', use: { ...devices['Galaxy S9+'] } },
      { name: 'ipad', use: { ...devices['iPad (gen 7)'] } },
      { name: 'android-tablet', use: { ...devices['Galaxy Tab S4'] } }
    ]
  : [];

// PDP Add-to-Cart device matrix. Active ONLY when PDP_CART=1 (set by the
// test:pdp-cart* scripts), so other suites' projects are completely unaffected.
// Device profile = one Playwright project, so the runner manages browsers,
// parallelism, and native trace/screenshot/video for us (no custom tracing).
const pdpCartProjects = [
  { name: 'desktop-chrome', testDir: './tests/pdp-cart', use: { ...devices['Desktop Chrome'] } },
  { name: 'desktop-safari', testDir: './tests/pdp-cart', use: { ...devices['Desktop Safari'] } },
  { name: 'ios-safari-iphone', testDir: './tests/pdp-cart', use: { ...devices['iPhone 15'] } },
  { name: 'android-phone', testDir: './tests/pdp-cart', use: { ...devices['Pixel 7'] } },
  { name: 'ios-ipad', testDir: './tests/pdp-cart', use: { ...devices['iPad (gen 7)'] } },
  { name: 'android-tablet', testDir: './tests/pdp-cart', use: { ...devices['Galaxy Tab S4'] } }
];

// Serial by default (one browser at a time) so headed runs don't overwhelm the machine.
// Opt into parallelism explicitly with WORKERS=4 (or a percentage like 50%).
// The PDP add-to-cart suite (PDP_CART=1) runs at low concurrency to avoid the
// target site throttling/refusing the burst of automated traffic: 2 locally, 1 in CI.
const pdpCartWorkers = process.env.CI ? 1 : 2;
const workers: number | `${number}%` = process.env.WORKERS
  ? (process.env.WORKERS.endsWith('%') ? (process.env.WORKERS as `${number}%`) : Number(process.env.WORKERS))
  : (process.env.PDP_CART ? pdpCartWorkers : 1);

export default defineConfig({
  testDir: './tests',
  // Unit tests run under node:test (npm run test:unit), not Playwright.
  testIgnore: ['**/unit/**'],
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers,
  // Retries surface flaky tests: a pass-on-retry is reported as "flaky", not "passed".
  retries: Number(process.env.RETRIES ?? (process.env.CI ? 2 : 0)),
  // Filter by tag: TEST_TAGS="@smoke" or "@seo|@security"
  grep: process.env.TEST_TAGS ? new RegExp(process.env.TEST_TAGS) : undefined,
  reporter: [
    ['html', { outputFolder: 'reports/playwright-report', open: 'never' }],
    ['json', { outputFile: 'reports/test-results.json' }],
    ['list'],
    // Self-guarding: only emits the PDP add-to-cart summary when that suite runs.
    ['./tests/pdp-cart/summaryReporter.ts']
  ],
  outputDir: 'test-results',
  use: {
    baseURL: process.env.BASE_URL ?? 'https://www.sportstech.de/',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    ignoreHTTPSErrors: true
  },
  projects: process.env.PDP_CART
    ? pdpCartProjects
    : (revenueMatrixProjects.length ? revenueMatrixProjects : browserProjects)
});
