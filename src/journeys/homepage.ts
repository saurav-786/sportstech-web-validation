/** homepage.ts — Phase 2: homepage revenue-surface validation. */
import { firstVisible, gotoSafe, SELECTORS, step, type JourneyContext } from './common.js';
import { appConfig } from '../config.js';
import { issue } from '../validators/common.js';

export async function validateHomepage(ctx: JourneyContext): Promise<void> {
  if (!(await gotoSafe(ctx, appConfig.baseUrl, 'discovery'))) return;
  const { page } = ctx;

  await step(ctx, { name: 'Hero / primary banner present', stage: 'discovery', severityOnFail: 'high',
    fix: 'Restore the hero banner — first-impression and primary CTA surface.' }, async () => {
    const hero = await firstVisible(page, ['header + section', 'main img', '[class*="hero" i]', '[class*="banner" i]', 'picture img'], 3000);
    return hero !== null;
  });

  await step(ctx, { name: 'Primary CTA visible', stage: 'discovery', severityOnFail: 'high',
    fix: 'Ensure a visible primary call-to-action (shop/jetzt kaufen) above the fold.' }, async () => {
    const cta = await firstVisible(page, [
      'a:has-text("Jetzt")', 'a:has-text("Shop")', 'a:has-text("Kaufen")',
      'a:has-text("Entdecken")', 'main a.button', 'main button',
    ], 2500);
    return cta !== null;
  });

  await step(ctx, { name: 'Search box usable', stage: 'discovery', severityOnFail: 'medium',
    fix: 'Restore site search — a top driver of product discovery and conversion.' }, async () => {
    // Many shops hide search behind a toggle icon; open it first if present.
    const toggle = await firstVisible(page, [
      'button[aria-label*="such" i]', 'button[aria-label*="search" i]',
      '[class*="search" i] button', 'a[aria-label*="such" i]', 'a[href*="search"]',
    ], 1200);
    if (toggle) await toggle.click({ timeout: 1500 }).catch(() => undefined);
    const search = await firstVisible(page, SELECTORS.search, 2500);
    if (!search) return false;
    await search.click({ timeout: 2000 }).catch(() => undefined);
    await search.fill(appConfig.revenue.seedSearchTerm).catch(() => undefined);
    return true;
  });

  await step(ctx, { name: 'Primary navigation present', stage: 'discovery', severityOnFail: 'high',
    fix: 'Restore main navigation/category menu.' }, async () => {
    const nav = await firstVisible(page, ['nav a', 'header nav', '[role="navigation"] a'], 2500);
    return nav !== null;
  });

  // Category links + images are diagnostic (medium) rather than journey-blocking.
  const catCount = await page.locator('nav a, header a[href]').count().catch(() => 0);
  if (catCount < 3) {
    ctx.issues.push({ ...issue('journey', 'medium', page.url(),
      `Only ${catCount} navigation link(s) found on homepage.`,
      'Verify category navigation renders for this device.'), funnelStage: 'discovery', device: ctx.device });
  }

  const brokenImages = await page.locator('img').evaluateAll((imgs) =>
    imgs.filter((i) => {
      const el = i as HTMLImageElement;
      return el.complete && el.naturalWidth === 0;
    }).length).catch(() => 0);
  if (brokenImages > 0) {
    ctx.issues.push({ ...issue('journey', brokenImages > 3 ? 'high' : 'medium', page.url(),
      `${brokenImages} broken image(s) on homepage.`,
      'Fix broken image sources — degrades trust and conversion.'), funnelStage: 'discovery', device: ctx.device });
  }
}
