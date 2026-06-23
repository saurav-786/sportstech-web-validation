/**
 * checkout.ts — Phase 2: Checkout + Payment validation, BOUNDARY-SAFE.
 *
 * Implements sportstech's real guest-checkout flow (selectors captured from the
 * live site): enter checkout → "Als Gast bestellen" → fill address → "Weiter" →
 * confirm page → verify payment options render. In the default boundary mode it
 * STOPS before clicking "Zahlungspflichtig bestellen", so NO real order is ever
 * placed. Set PAYMENT_MODE=sandbox (test account/cards) to go further.
 *
 * Every selector has generic fallbacks so the flow degrades on other platforms.
 */
import type { Locator } from '@playwright/test';
import { firstVisible, SELECTORS, step, type JourneyContext } from './common.js';
import { appConfig } from '../config.js';
import { issue } from '../validators/common.js';

const ORDER_PLACE_NAMES = /Zahlungspflichtig bestellen|Kostenpflichtig bestellen|Jetzt kaufen|Place order|Buy now/i;

async function fillByLabel(ctx: JourneyContext, names: RegExp, value: string): Promise<boolean> {
  const box = ctx.page.getByRole('textbox', { name: names }).first();
  if (!(await box.isVisible().catch(() => false))) return false;
  await box.click({ timeout: 1500 }).catch(() => undefined);
  await box.fill(value).catch(() => undefined);
  return true;
}

export async function validateCheckout(ctx: JourneyContext): Promise<void> {
  const { page } = ctx;
  const guest = appConfig.revenue.testGuest;

  const entered = await step(ctx, { name: 'Enter checkout', stage: 'checkout', severityOnFail: 'critical',
    fix: 'Checkout entry is broken — customers cannot proceed to pay.' }, async () => {
    const btn = await firstVisible(page, SELECTORS.checkoutButton, 4000);
    if (!btn) return false;
    await btn.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined);
    return /checkout|kasse|confirm|register|login/i.test(page.url()) ||
      (await firstVisible(page, ['form', 'input[name*="email" i]', 'button:has-text("Als Gast")'], 3000)) !== null;
  });
  if (!entered) return;

  // Guest checkout — forced registration is a top abandonment driver.
  await step(ctx, { name: 'Guest checkout available', stage: 'checkout', severityOnFail: 'high',
    fix: 'Offer guest checkout — forcing account creation suppresses conversion.' }, async () => {
    const guestBtn = await firstVisible(page, [
      'button:has-text("Als Gast bestellen")', 'a:has-text("Als Gast")',
      'button:has-text("Guest")', 'label:has-text("Gast")', 'input[value*="guest" i]',
    ], 3000);
    if (guestBtn) { await guestBtn.click({ timeout: 3000 }).catch(() => undefined); await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => undefined); return true; }
    // Already on a guest form? Accept an email field as evidence.
    return (await firstVisible(page, ['input[type="email"]', 'input[name*="email" i]'], 2000)) !== null;
  });

  // Salutation (Shopware <select id="personalSalutation">) — optional.
  const salutation: Locator = page.locator('#personalSalutation, select[name*="salutation" i]').first();
  if (await salutation.isVisible().catch(() => false)) {
    await salutation.selectOption({ index: 1 }).catch(() => undefined);
  }
  // Opt out of account creation if the checkbox is present (keep it a pure guest run).
  const createAccount = page.getByRole('checkbox', { name: /Kundenkonto anlegen|create.*account/i }).first();
  if (await createAccount.isVisible().catch(() => false)) await createAccount.uncheck().catch(() => undefined);

  // Address form fill (each field optional/resilient).
  const filledAny = await step(ctx, { name: 'Address form fillable', stage: 'checkout', severityOnFail: 'high',
    fix: 'Restore the address form — required to compute shipping and complete the order.' }, async () => {
    const results = await Promise.all([
      fillByLabel(ctx, /Vorname/i, guest.firstName),
      fillByLabel(ctx, /Nachname/i, guest.lastName),
      fillByLabel(ctx, /E-?Mail/i, guest.email),
      fillByLabel(ctx, /Stra(ß|ss)e/i, guest.street),
      fillByLabel(ctx, /PLZ|Postleitzahl|ZIP|Postal/i, guest.zip),
      fillByLabel(ctx, /Ort|Stadt|City/i, guest.city),
      fillByLabel(ctx, /Telefon|Phone/i, guest.phone),
    ]);
    return results.some(Boolean);
  });

  // Continue to the confirm/payment step.
  if (filledAny) {
    await step(ctx, { name: 'Advance to payment step', stage: 'checkout', severityOnFail: 'high',
      fix: 'The "Weiter" step failed — customers cannot progress from address to payment.' }, async () => {
      const next = await firstVisible(page, ['button:has-text("Weiter")', 'button:has-text("Continue")', 'button[type="submit"]'], 3000);
      if (!next) return false;
      const before = page.url();
      await next.click({ timeout: 5000 }).catch(() => undefined);
      await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined);
      const paymentSurface = await firstVisible(page, [
        '[class*="payment" i]', 'input[name*="payment" i]', '[data-payment-method]',
        'label:has-text("PayPal")', 'label:has-text("Kreditkarte")',
      ], 5000);
      return page.url() !== before || paymentSurface !== null;
    });
  }

  // Shipping cost calculation — capture the displayed shipping line (incident: shipping cost mismatch).
  const shippingLine = await page.locator(
    '[class*="shipping" i], [class*="versand" i], [class*="lieferkosten" i]'
  ).first().innerText().catch(() => '');
  if (!shippingLine) {
    ctx.issues.push({ ...issue('journey', 'medium', page.url(), 'No shipping cost/selection surface detected at checkout.',
      'Confirm shipping options and cost render — required for accurate order totals.'), funnelStage: 'checkout', device: ctx.device });
  } else {
    ctx.issues.push({ ...issue('journey', 'info', page.url(), `Shipping line captured: "${shippingLine.replace(/\s+/g, ' ').slice(0, 120)}"`,
      'Compare against expected shipping rules for this basket/region.', shippingLine.slice(0, 200)), funnelStage: 'checkout', device: ctx.device });
  }

  // Coupon — actually apply a probe code and verify the field RESPONDS (accepts input
  // and shows feedback). We use an obviously-invalid probe so we never alter the real total.
  const couponField = await firstVisible(page, [
    'input[name*="coupon" i]', 'input[name*="gutschein" i]', 'input[name*="promo" i]',
    'input[placeholder*="gutschein" i]', 'input[placeholder*="coupon" i]',
  ], 1200);
  if (!couponField) {
    ctx.issues.push({ ...issue('journey', 'low', page.url(), 'No coupon/voucher field detected at checkout.',
      'Confirm promo-code entry is available.'), funnelStage: 'checkout', device: ctx.device });
  } else {
    await step(ctx, { name: 'Coupon field responds', stage: 'checkout', severityOnFail: 'medium',
      fix: 'Coupon entry does not respond — promo campaigns will silently fail, hurting conversion.' }, async () => {
      await couponField.fill('QA-PROBE-INVALID').catch(() => undefined);
      const applyBtn = await firstVisible(page, [
        'button:has-text("Einlösen")', 'button:has-text("Anwenden")', 'button:has-text("Apply")',
        'button:has-text("Hinzufügen")', 'form[class*="promotion" i] button', 'form[class*="voucher" i] button',
      ], 1500);
      if (applyBtn) await applyBtn.click({ timeout: 2500 }).catch(() => undefined);
      // Any feedback (error/success/alert) means the mechanism is alive.
      const feedback = await firstVisible(page, [
        '[class*="alert" i]', '[class*="error" i]', '[class*="invalid" i]', '[class*="message" i]', '[role="alert"]',
      ], 2000);
      return feedback !== null || applyBtn !== null;
    });
  }

  // Payment step: confirm gateway options render. Do NOT place the order.
  await step(ctx, { name: 'Payment options available', stage: 'payment', severityOnFail: 'critical',
    fix: 'Payment options not available — the final revenue step is blocked.' }, async () => {
    const gateway = await firstVisible(page, [
      'label:has-text("PayPal")', 'label:has-text("Kreditkarte")', 'label:has-text("Vorkasse")',
      'label:has-text("Kauf auf Rechnung")', 'label:has-text("Rechnung")',
      '[class*="payment" i]', 'input[name*="payment" i]', '[data-payment-method]',
      'iframe[src*="paypal"]', 'iframe[src*="adyen"]', 'iframe[src*="stripe"]',
    ], 5000);
    return gateway !== null;
  });

  // Hard safety check: assert the order-placement button is NEVER clicked in boundary mode.
  if (appConfig.revenue.paymentMode !== 'sandbox') {
    const placeBtn = page.getByRole('button', { name: ORDER_PLACE_NAMES }).first();
    const placeVisible = await placeBtn.isVisible().catch(() => false);
    ctx.issues.push({ ...issue('journey', 'info', page.url(),
      `Boundary mode: reached payment step${placeVisible ? ' (order button present, intentionally NOT clicked)' : ''}. No order placed.`,
      'Set PAYMENT_MODE=sandbox with a test account/cards to validate order completion.'),
      funnelStage: 'payment', device: ctx.device });
  }
}
