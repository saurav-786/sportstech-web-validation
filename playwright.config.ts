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

// Serial by default (one browser at a time) so headed runs don't overwhelm the machine.
// Opt into parallelism explicitly with WORKERS=4 (or a percentage like 50%).
const workers: number | `${number}%` = process.env.WORKERS
  ? (process.env.WORKERS.endsWith('%') ? (process.env.WORKERS as `${number}%`) : Number(process.env.WORKERS))
  : 1;

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
    ['list']
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
  projects: browserProjects
});
