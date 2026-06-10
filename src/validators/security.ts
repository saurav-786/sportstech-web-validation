import type { APIRequestContext, BrowserContext, Page, Response } from '@playwright/test';
import type { ValidationIssue } from '../types.js';
import { issue } from './common.js';

const requiredHeaders: Array<{ header: string; severity: ValidationIssue['severity']; fix: string }> = [
  { header: 'content-security-policy', severity: 'high', fix: 'Define a CSP restricting script, style, image, frame, and connect sources.' },
  { header: 'strict-transport-security', severity: 'high', fix: 'Add Strict-Transport-Security with a safe max-age after HTTPS validation.' },
  { header: 'x-content-type-options', severity: 'low', fix: 'Add X-Content-Type-Options: nosniff.' },
  { header: 'referrer-policy', severity: 'low', fix: 'Add Referrer-Policy: strict-origin-when-cross-origin.' },
  { header: 'permissions-policy', severity: 'low', fix: 'Add Permissions-Policy disabling unused APIs (camera, geolocation, microphone).' }
];

const sensitivePatterns: Array<{ name: string; pattern: RegExp }> = [
  { name: 'AWS access key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'Private key block', pattern: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
  { name: 'Bearer token', pattern: /bearer\s+[a-z0-9_-]{30,}/i },
  { name: 'Stripe secret key', pattern: /sk_live_[0-9a-zA-Z]{20,}/ },
  { name: 'Google API key', pattern: /AIza[0-9A-Za-z_-]{35}/ }
];

export async function validateSecurity(request: APIRequestContext, pageUrl: string, response?: Response | null): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const headers = response?.headers() ?? (await request.get(pageUrl, { maxRedirects: 0 }).catch(() => null))?.headers() ?? {};
  const lowerHeaders = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));

  // HTTPS enforcement
  if (pageUrl.startsWith('http://')) {
    issues.push(issue('security', 'critical', pageUrl, 'Page served over plain HTTP.', 'Redirect all HTTP traffic to HTTPS.'));
  } else {
    const httpUrl = pageUrl.replace(/^https:/, 'http:');
    const httpResponse = await request.get(httpUrl, { maxRedirects: 0 }).catch(() => null);
    const status = httpResponse?.status();
    if (status && status < 300) {
      issues.push(issue('security', 'high', pageUrl, 'HTTP version of the page does not redirect to HTTPS.', 'Enforce a 301 redirect from HTTP to HTTPS.'));
    }
  }

  for (const { header, severity, fix } of requiredHeaders) {
    if (!lowerHeaders[header]) {
      issues.push(issue('security', severity, pageUrl, `Missing ${header} header.`, fix));
    }
  }
  if (!lowerHeaders['x-frame-options'] && !lowerHeaders['content-security-policy']?.includes('frame-ancestors')) {
    issues.push(issue('security', 'medium', pageUrl, 'Missing clickjacking protection.', 'Add X-Frame-Options or CSP frame-ancestors.'));
  }
  const csp = lowerHeaders['content-security-policy'] ?? '';
  if (csp && /unsafe-inline|unsafe-eval/.test(csp)) {
    issues.push(issue('security', 'medium', pageUrl, 'CSP allows unsafe-inline or unsafe-eval.', 'Use nonces or hashes instead of unsafe-* directives.', csp.slice(0, 200)));
  }

  return issues;
}

/** Cookie flag validation: Secure, HttpOnly, SameSite. */
export async function validateCookies(context: BrowserContext, pageUrl: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const cookies = await context.cookies(pageUrl).catch(() => []);
  for (const cookie of cookies) {
    const flags: string[] = [];
    if (!cookie.secure) flags.push('Secure');
    if (!cookie.httpOnly && /sess|auth|token|csrf|login/i.test(cookie.name)) flags.push('HttpOnly');
    if (cookie.sameSite === 'None' && !cookie.secure) flags.push('SameSite=None without Secure');
    if (flags.length > 0) {
      issues.push(issue('security', /sess|auth|token/i.test(cookie.name) ? 'high' : 'medium', pageUrl,
        `Cookie "${cookie.name}" missing flags: ${flags.join(', ')}.`,
        'Set Secure, HttpOnly (for session cookies), and an explicit SameSite attribute.'));
    }
  }
  return issues;
}

/** In-page checks: mixed content, sensitive data in HTML/storage, third-party scripts, open-redirect params. */
export async function validatePageSecurity(page: Page, pageUrl: string): Promise<ValidationIssue[]> {
  const data = await page.evaluate(() => {
    const mixed = [
      ...Array.from(document.querySelectorAll<HTMLElement>('img[src^="http:"], script[src^="http:"], link[href^="http:"], iframe[src^="http:"], video[src^="http:"], audio[src^="http:"]'))
        .map((node) => node.getAttribute('src') ?? node.getAttribute('href') ?? '')
    ].filter(Boolean);
    const thirdPartyScripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'))
      .map((script) => script.src)
      .filter((src) => { try { return new URL(src).hostname !== location.hostname; } catch { return false; } });
    const storage = (store: Storage) => {
      const entries: Record<string, string> = {};
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i)!;
        entries[key] = (store.getItem(key) ?? '').slice(0, 500);
      }
      return entries;
    };
    const redirectParams = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
      .map((a) => a.href)
      .filter((href) => /[?&](url|redirect|next|return|goto|dest|target)=https?/i.test(href))
      .slice(0, 10);
    return {
      protocol: location.protocol,
      mixed: mixed.slice(0, 20),
      thirdPartyScripts: Array.from(new Set(thirdPartyScripts.map((src) => { try { return new URL(src).hostname; } catch { return src; } }))),
      html: document.documentElement.outerHTML.slice(0, 400_000),
      localStorage: storage(localStorage),
      sessionStorage: storage(sessionStorage),
      redirectParams
    };
  }).catch(() => null);

  if (!data) return [];
  const issues: ValidationIssue[] = [];

  if (data.protocol === 'https:' && data.mixed.length > 0) {
    issues.push(issue('security', 'high', pageUrl, `${data.mixed.length} mixed-content (HTTP) resources on an HTTPS page.`, 'Serve all assets over HTTPS.', data.mixed.slice(0, 5).join('\n')));
  }
  for (const { name, pattern } of sensitivePatterns) {
    if (pattern.test(data.html)) {
      issues.push(issue('security', 'critical', pageUrl, `Possible ${name} exposed in page HTML.`, 'Remove the secret from client-delivered markup and rotate it.'));
    }
    const storageHit = [...Object.entries(data.localStorage), ...Object.entries(data.sessionStorage)]
      .find(([, value]) => pattern.test(value));
    if (storageHit) {
      issues.push(issue('security', 'high', pageUrl, `Possible ${name} in browser storage key "${storageHit[0]}".`, 'Avoid persisting secrets in localStorage/sessionStorage.'));
    }
  }
  if (data.redirectParams.length > 0) {
    issues.push(issue('security', 'medium', pageUrl, `${data.redirectParams.length} link(s) carry open-redirect-style parameters.`, 'Validate redirect targets server-side against an allowlist.', data.redirectParams.slice(0, 3).join('\n')));
  }
  if (data.thirdPartyScripts.length > 12) {
    issues.push(issue('security', 'low', pageUrl, `${data.thirdPartyScripts.length} third-party script origins loaded.`, 'Audit third-party scripts; add Subresource Integrity where possible.', data.thirdPartyScripts.join(', ')));
  }

  return issues;
}

/** Reflected-XSS surface probe: types a marker into search/text inputs and checks for unescaped reflection. */
export async function probeXssSurface(page: Page, pageUrl: string): Promise<ValidationIssue[]> {
  const marker = `pwxss${Date.now()}`;
  const probe = `"><i data-x="${marker}">`;
  const issues: ValidationIssue[] = [];

  const inputs = page.locator('input[type="search"], input[type="text"][name*="search" i], input[name="q"], input[name="s"]');
  const count = Math.min(await inputs.count().catch(() => 0), 2);
  for (let i = 0; i < count; i += 1) {
    const input = inputs.nth(i);
    if (!(await input.isVisible().catch(() => false))) continue;
    await input.fill(probe, { timeout: 2_000 }).catch(() => undefined);
    await input.press('Enter', { timeout: 2_000 }).catch(() => undefined);
    await page.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => undefined);
    const reflected = await page.evaluate((m) => document.querySelector(`i[data-x="${m}"]`) !== null, marker).catch(() => false);
    if (reflected) {
      issues.push(issue('security', 'critical', page.url(), 'Search input reflects unescaped HTML (XSS surface).', 'HTML-encode all user input reflected into responses; add CSP as defense in depth.'));
    }
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  }
  return issues;
}
