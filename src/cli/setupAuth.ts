import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { authConfig, authEnabled, loginAndSaveState } from '../auth/auth.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('setup-auth');

/**
 * One-time login: establishes a session and writes storage state for reuse.
 * Run `npm run auth:login` (add HEADED=1 to watch). Re-run when the session expires.
 */
if (!authEnabled()) {
  log.warn('AUTH_MODE=none — nothing to do. Set AUTH_MODE=custom|form in .env first.');
  process.exit(0);
}

await mkdir(dirname(authConfig.storagePath), { recursive: true });
const browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();

const ok = await loginAndSaveState(page);
if (process.env.HEADED === '1') await page.waitForTimeout(2_500);
await browser.close();

if (ok) {
  log.info(`✅ Authenticated. Storage state at ${authConfig.storagePath}. Crawler & suites will reuse it.`);
  process.exit(0);
} else {
  log.error('❌ Login failed. Check AUTH_* values in .env (endpoint, credentials, selectors).');
  process.exit(1);
}
