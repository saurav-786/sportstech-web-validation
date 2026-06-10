import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { appConfig } from '../config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('auth');

/**
 * Authentication module.
 *
 * Modes (AUTH_MODE in .env):
 *   none    — public pages only (default)
 *   form    — username/password form login; selectors + credentials from env
 *   storage — reuse a previously saved Playwright storage state (AUTH_STORAGE_PATH)
 *   custom  — OAuth/SSO: implement loginCustom() below for your IdP redirect dance
 *
 * Credentials go in .env (never commit):
 *   AUTH_MODE=form
 *   AUTH_LOGIN_URL=https://www.example.com/login
 *   AUTH_USERNAME=test-user@example.com
 *   AUTH_PASSWORD=********
 *   AUTH_USERNAME_SELECTOR=input[name="email"]      (optional, has defaults)
 *   AUTH_PASSWORD_SELECTOR=input[type="password"]
 *   AUTH_SUBMIT_SELECTOR=button[type="submit"]
 *   AUTH_SUCCESS_URL_PATTERN=/account                 (substring/regex proving login worked)
 *   AUTH_STORAGE_PATH=.auth/storage-state.json
 */

export const authConfig = {
  mode: (process.env.AUTH_MODE ?? 'none') as 'none' | 'form' | 'storage' | 'custom',
  loginUrl: process.env.AUTH_LOGIN_URL ?? '',
  loginEndpoint: process.env.AUTH_LOGIN_ENDPOINT ?? '',
  username: process.env.AUTH_USERNAME ?? '',
  password: process.env.AUTH_PASSWORD ?? '',
  usernameSelector: process.env.AUTH_USERNAME_SELECTOR ?? 'input[type="email"], input[name*="email" i], input[name*="user" i]',
  passwordSelector: process.env.AUTH_PASSWORD_SELECTOR ?? 'input[type="password"]',
  submitSelector: process.env.AUTH_SUBMIT_SELECTOR ?? 'button[type="submit"], input[type="submit"]',
  successPattern: process.env.AUTH_SUCCESS_URL_PATTERN ?? '',
  storagePath: process.env.AUTH_STORAGE_PATH ?? '.auth/storage-state.json'
};

export function authEnabled(): boolean {
  return authConfig.mode !== 'none';
}

/** Perform login (per AUTH_MODE) and persist storage state for reuse by all workers/suites. */
export async function loginAndSaveState(page: Page): Promise<boolean> {
  if (authConfig.mode === 'storage') return existsSync(authConfig.storagePath);
  if (authConfig.mode === 'custom') return loginCustom(page);
  if (authConfig.mode === 'form') return loginViaForm(page);
  return false;
}

/**
 * Custom / IdP login. Default implementation targets the sportstech.de flow:
 *   POST {AUTH_LOGIN_ENDPOINT} (https://www.sportstech.de/mm-fp/customer) with the
 *   credentials, replaying the form within the page context so cookies are set on the
 *   live browser session, then persists storage state. Falls back to UI form login if
 *   the endpoint flow does not establish a session.
 *
 * For a different OAuth/SSO provider, replace the body of this function with your
 * provider's redirect/consent/MFA steps and finish with page.context().storageState(...).
 */
export async function loginCustom(page: Page): Promise<boolean> {
  const endpoint = authConfig.loginEndpoint;
  if (!endpoint || !authConfig.username || !authConfig.password) {
    log.warn('AUTH_MODE=custom requires AUTH_LOGIN_ENDPOINT, AUTH_USERNAME, AUTH_PASSWORD — skipping.');
    return false;
  }

  log.info(`Custom login: POST ${endpoint} as ${authConfig.username}`);
  // Load origin first so the request inherits cookies/CSRF and the browser keeps the session.
  await page.goto(authConfig.loginUrl || new URL(endpoint).origin, { waitUntil: 'domcontentloaded', timeout: appConfig.requestTimeoutMs }).catch(() => undefined);
  await dismissCookieBanner(page);

  // Replay the documented POST from within the page so Set-Cookie applies to this context.
  const result = await page.evaluate(async ({ url, email, password }) => {
    const attempts = [
      { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) },
      { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password }).toString() }
    ];
    for (const attempt of attempts) {
      try {
        const response = await fetch(url, { method: 'POST', credentials: 'include', headers: attempt.headers, body: attempt.body });
        if (response.ok || response.status === 302) return { ok: true, status: response.status };
      } catch { /* try next encoding */ }
    }
    return { ok: false, status: 0 };
  }, { url: endpoint, email: authConfig.username, password: authConfig.password }).catch(() => ({ ok: false, status: 0 }));

  if (result.ok) {
    await page.reload({ waitUntil: 'networkidle' }).catch(() => undefined);
    if (await isLoggedIn(page)) {
      await page.context().storageState({ path: authConfig.storagePath });
      log.info(`Custom login OK (HTTP ${result.status}). Storage state saved.`);
      return true;
    }
  }

  log.warn('Custom API login did not establish a session — falling back to UI form login.');
  return loginViaForm(page);
}

/** Heuristic session check: presence of a logout control or account-only markers. */
async function isLoggedIn(page: Page): Promise<boolean> {
  if (authConfig.successPattern && new RegExp(authConfig.successPattern, 'i').test(page.url())) return true;
  return page.evaluate(() => {
    const text = document.body?.innerText?.toLowerCase() ?? '';
    return /logout|abmelden|mein konto|my account|sign out/.test(text);
  }).catch(() => false);
}

async function dismissCookieBanner(page: Page): Promise<void> {
  for (const label of ['Alle akzeptieren', 'Accept all', 'Akzeptieren', 'Accept', 'Zustimmen']) {
    const button = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
    if (await button.isVisible().catch(() => false)) { await button.click({ timeout: 2_000 }).catch(() => undefined); break; }
  }
}

/** Shared UI form login used by both AUTH_MODE=form and the custom fallback. */
async function loginViaForm(page: Page): Promise<boolean> {
  if (!authConfig.username || !authConfig.password) return false;
  const loginUrl = authConfig.loginUrl || `${new URL(authConfig.loginEndpoint || appConfig.baseUrl).origin}/login`;
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: appConfig.requestTimeoutMs }).catch(() => undefined);
  await dismissCookieBanner(page);
  const email = page.locator(authConfig.usernameSelector).first();
  const pass = page.locator(authConfig.passwordSelector).first();
  if (!(await email.isVisible().catch(() => false))) {
    // Some sites reveal the login form behind an account icon
    await page.getByRole('link', { name: /login|anmelden|konto|account/i }).first().click({ timeout: 3_000 }).catch(() => undefined);
  }
  await email.fill(authConfig.username).catch(() => undefined);
  await pass.fill(authConfig.password).catch(() => undefined);
  await page.locator(authConfig.submitSelector).first().click({ timeout: 5_000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  if (await isLoggedIn(page)) {
    await page.context().storageState({ path: authConfig.storagePath });
    log.info(`UI form login OK. Storage state saved to ${authConfig.storagePath}`);
    return true;
  }
  log.error('UI form login failed — check selectors/credentials.');
  return false;
}

/** Returns a context option object with storage state when auth is active. */
export function contextOptionsWithAuth(): { storageState?: string } {
  if (authEnabled() && existsSync(authConfig.storagePath)) {
    return { storageState: authConfig.storagePath };
  }
  return {};
}

/** Create an authenticated browser context (logs in first if no saved state). */
export async function createAuthenticatedContext(browser?: Browser): Promise<BrowserContext> {
  const owned = !browser;
  const instance = browser ?? await chromium.launch();
  if (authEnabled() && !existsSync(authConfig.storagePath)) {
    const setupContext = await instance.newContext({ ignoreHTTPSErrors: true });
    const page = await setupContext.newPage();
    if (authConfig.mode === 'custom') await loginCustom(page);
    else await loginAndSaveState(page);
    await setupContext.close();
  }
  const context = await instance.newContext({ ignoreHTTPSErrors: true, ...contextOptionsWithAuth() });
  if (owned) {
    // Caller owns lifecycle via context.browser()
  }
  return context;
}

/** Detect whether a URL requires authentication: compare anonymous vs authenticated access. */
export function looksLikeAuthRedirect(finalUrl: string, requestedUrl: string): boolean {
  if (finalUrl === requestedUrl) return false;
  return /login|signin|anmelden|auth|sso|account\/login/i.test(finalUrl);
}
