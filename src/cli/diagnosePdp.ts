/**
 * diagnosePdp.ts — quick reachability probe for PDP add-to-cart runs.
 *
 * Loads one (or N) PDPs in a REAL headed browser and prints, per URL:
 *   • HTTP status · load time · page title
 *   • whether the add-to-cart button is visible
 *   • a verdict: product page OK, bot-challenge/block, or connection failure
 *
 * Use this when the suite shows mass timeouts / ERR_SOCKET_NOT_CONNECTED to tell
 * apart the two very different causes:
 *   • throttling under parallel load  → pages load fine here ⇒ lower workers
 *   • hard bot-protection / proxy block → challenge page or nav failure here
 *
 *   npm run diagnose:pdp                       # 1 PDP, headed
 *   PDP_DIAGNOSE_COUNT=5 npm run diagnose:pdp  # first 5 cached PDPs, sequential
 *   npm run diagnose:pdp -- https://www.sportstech.de/laufband/f75
 *   HEADLESS=1 npm run diagnose:pdp            # run headless (e.g. CI)
 */
import { chromium } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appConfig } from '../config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('pdp-diagnose');

// Markers that indicate a bot wall / WAF challenge rather than the real product page.
const CHALLENGE = /just a moment|attention required|cf-chl|checking your browser|access denied|verify you are human|are you a robot|captcha|bitte bestätigen|zugriff verweigert/i;

function pickUrls(): string[] {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (args.length) return args;

  if (process.env.PDP_LIST) {
    const list = process.env.PDP_LIST.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    if (list.length) return list;
  }

  const cache = join('test-data', 'pdp-cart-urls.json');
  if (existsSync(cache)) {
    try {
      const data = JSON.parse(readFileSync(cache, 'utf8')) as { products?: Array<{ url: string }> };
      const urls = (data.products ?? []).map((p) => p.url).filter(Boolean);
      if (urls.length) return urls;
    } catch {
      /* fall through to default */
    }
  }

  return [new URL('/laufband/f75', appConfig.baseUrl).toString()];
}

interface Probe {
  url: string;
  status: number;
  title: string;
  atcVisible: boolean;
  ms: number;
  verdict: string;
}

async function main(): Promise<void> {
  const all = pickUrls();
  const count = Math.max(1, Number(process.env.PDP_DIAGNOSE_COUNT ?? 1));
  const urls = all.slice(0, count);
  const headless = process.env.HEADLESS === '1';

  log.info(`Launching chromium (${headless ? 'headless' : 'headed'}) · probing ${urls.length} PDP(s)…`);
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  const results: Probe[] = [];

  try {
    for (const url of urls) {
      const t0 = Date.now();
      let status = 0;
      let title = '';
      let atcVisible = false;
      let verdict = '';
      try {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        status = resp?.status() ?? 0;
        title = await page.title().catch(() => '');
        const body = (await page.locator('body').innerText({ timeout: 3_000 }).catch(() => '')).slice(0, 600);
        atcVisible =
          (await page.getByRole('button', { name: /in den warenkorb|add to cart/i }).first().isVisible().catch(() => false)) ||
          (await page.locator('.btn-buy, [data-add-to-cart]').first().isVisible().catch(() => false));
        const blocked = status === 403 || status === 429 || status === 503 || CHALLENGE.test(title) || CHALLENGE.test(body);
        verdict = blocked
          ? '⛔ BOT-CHALLENGE / BLOCK'
          : status >= 400
            ? `⚠️ HTTP ${status}`
            : atcVisible
              ? '✅ product page OK (ATC visible)'
              : '🟡 loaded but ATC not visible';
      } catch (err) {
        verdict = `❌ NAV FAILED: ${err instanceof Error ? err.message : String(err)}`;
      }
      const ms = Date.now() - t0;
      results.push({ url, status, title, atcVisible, ms, verdict });
      log.info(`[${status || 'ERR'}] ${(ms / 1000).toFixed(1)}s · ${verdict} · "${title || '—'}" · ${url}`);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  const blocks = results.filter((r) => /CHALLENGE|BLOCK|HTTP 4|HTTP 5/.test(r.verdict)).length;
  const navFails = results.filter((r) => /NAV FAILED/.test(r.verdict)).length;
  const ok = results.filter((r) => r.verdict.startsWith('✅')).length;

  log.info('─'.repeat(60));
  if (blocks) {
    log.warn(`VERDICT: bot-protection / WAF block on ${blocks}/${results.length} PDP(s). Reducing workers won't help — needs allow-listing, a real UA/session, or running from an allowed network.`);
  } else if (navFails) {
    log.warn(`VERDICT: ${navFails}/${results.length} connection/timeout failures even single-threaded. Consistent with network/proxy/VPN filtering or aggressive throttling — check the network this runs from.`);
  } else {
    log.info(`VERDICT: ${ok}/${results.length} PDP(s) loaded cleanly here. The suite's mass failures are throttling under PARALLEL load → lower workers (e.g. --workers=2) and keep retries/backoff.`);
  }
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
