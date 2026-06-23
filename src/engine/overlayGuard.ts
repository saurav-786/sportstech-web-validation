import type { Frame, Page } from '@playwright/test';
import { createLogger } from '../utils/logger.js';

const log = createLogger('overlay-guard');

/**
 * Centralized overlay / popup auto-dismisser.
 *
 * Cookie consent banners, newsletter modals, and chat widgets render an overlay on
 * top of the page and block automated interaction. This module clears them with a
 * layered strategy that runs across the main frame AND every iframe (CMPs are often
 * iframed) and pierces open shadow DOM (Usercentrics etc.):
 *   1. Known CMP "accept all" selectors (OneTrust, Cookiebot, Usercentrics, Didomi, …)
 *   2. Accept-style buttons by accessible name (German + English, incl. "Akzeptieren & Schließen")
 *   3. Generic close buttons / Escape for non-cookie modals (chat, newsletter)
 *
 * Use `dismissOverlays(page)` for a one-shot pass, or `installOverlayAutoDismiss(page)`
 * to auto-run it after every navigation so late-appearing popups are handled too.
 */

// CMP-specific accept selectors — fast path, most reliable.
const cmpAcceptSelectors = [
  '#onetrust-accept-btn-handler',
  '#accept-recommended-btn-handler',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '#CybotCookiebotDialogBodyButtonAccept',
  '[data-testid="uc-accept-all-button"]',
  'button[data-testid="uc-accept-all-button"]',
  '#didomi-notice-agree-button',
  '.didomi-continue-without-agreeing',
  '#truste-consent-button',
  '.cmplz-accept',
  '.cm-btn-success',
  '.cc-allow',
  '.cookie-accept, #cookie-accept, .cookie-consent-accept, .js-accept-cookies',
  'a._brlbs-btn-accept, .borlabs-cookie-btn-accept-all',
  'button[mode="primary"][data-role="all"]',
  '#ccm-widget button:has-text("Akzeptieren")',
  '.ccm-widget button:has-text("Akzeptieren")',
  '.ccm-root button:has-text("Akzeptieren")'
];

// Accept-style accessible names (case-insensitive substring). German first (matches sportstech.de).
const acceptLabels = [
  'Akzeptieren & Schließen', 'Akzeptieren und Schließen', 'Alle akzeptieren und schließen',
  'Alle akzeptieren', 'Alle Cookies akzeptieren', 'Akzeptieren', 'Zustimmen', 'Alle zulassen',
  'Einverstanden', 'Annehmen', 'Alle auswählen',
  'Accept all', 'Accept All Cookies', 'Accept cookies', 'Accept & close', 'Accept and close',
  'Allow all', 'Allow cookies', 'I agree', 'I accept', 'Agree', 'Got it', 'Understood'
];

// Close-style names for non-cookie popups (chat, newsletter, promos).
const closeLabels = ['Schließen', 'Close', 'Dismiss', 'No thanks', 'Nein danke', 'Kein Interesse', 'Maybe later', 'Später', '×', '✕'];

async function clickFirst(frame: Frame, selectors: string[], timeoutMs = 1_500): Promise<boolean> {
  for (const selector of selectors) {
    const locator = frame.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      if (await locator.click({ timeout: timeoutMs }).then(() => true).catch(() => false)) return true;
    }
  }
  return false;
}

async function clickByName(frame: Frame, labels: string[], roles: Array<'button' | 'link'> = ['button', 'link']): Promise<boolean> {
  for (const label of labels) {
    for (const role of roles) {
      const locator = frame.getByRole(role, { name: new RegExp(escapeRegExp(label), 'i') }).first();
      if (await locator.isVisible().catch(() => false)) {
        if (await locator.click({ timeout: 1_500 }).then(() => true).catch(() => false)) return true;
      }
    }
  }
  return false;
}

async function dismissInFrame(frame: Frame): Promise<boolean> {
  // 1. CMP accept selectors  2. accept by name
  if (await clickFirst(frame, cmpAcceptSelectors)) return true;
  if (await clickByName(frame, acceptLabels)) return true;
  return false;
}

/** One-shot dismissal across the page and all its frames. Returns true if something was closed. */
export async function dismissOverlays(page: Page): Promise<boolean> {
  let handled = false;

  // Accept cookies in main frame + every child frame (CMPs are commonly iframed).
  for (const frame of [page.mainFrame(), ...page.frames()]) {
    if (await dismissInFrame(frame).catch(() => false)) { handled = true; break; }
  }

  // Close newsletter/chat/promo modals — including icon-only "×" close buttons.
  if (await closeModals(page).catch(() => false)) handled = true;

  // Close lingering modals by accessible name.
  if (await clickByName(page.mainFrame(), closeLabels).catch(() => false)) handled = true;

  // Generic close affordances by aria-label / class.
  const genericClose = page.locator('[aria-label*="close" i], [aria-label*="schließen" i], [aria-label*="dismiss" i], [data-dismiss], button.close, .modal-close, .close-button, [class*="close" i][class*="btn" i]').first();
  if (await genericClose.isVisible().catch(() => false)) {
    if (await genericClose.click({ timeout: 1_000 }).then(() => true).catch(() => false)) handled = true;
  }

  // Escape closes many native <dialog>/role=dialog overlays.
  const dialogOpen = await page.locator('dialog[open], [role="dialog"], [aria-modal="true"]').first().isVisible().catch(() => false);
  if (dialogOpen) { await page.keyboard.press('Escape').catch(() => undefined); handled = true; }

  if (handled) log.debug(`Overlay dismissed on ${page.url()}`);
  return handled;
}

/**
 * Close newsletter / promo / chat modals via their close control — handling icon-only "×"
 * buttons that have no accessible name. Runs in-page so it can use geometry (a small,
 * text-less control in the modal's top-right corner is almost always the close button).
 * Never clicks the modal's primary CTA (those have text and aren't top-right).
 */
async function closeModals(page: Page): Promise<boolean> {
  const closed = await page.evaluate(() => {
    const isVisible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el as HTMLElement);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.01;
    };
    const modalSel = '[role="dialog"],[aria-modal="true"],[class*="modal" i],[class*="popup" i],[class*="newsletter" i],[class*="overlay" i],[class*="lightbox" i],[class*="dialog" i],[id*="popup" i],[class*="flyout" i],[class*="drawer" i]';
    const modals = Array.from(document.querySelectorAll(modalSel)).filter(isVisible);
    const looksLikeClose = (el: Element) => {
      const meta = `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''} ${el.className ?? ''} ${el.id ?? ''} ${el.getAttribute('data-testid') ?? ''}`;
      if (/close|dismiss|schlie|schliess|cancel|×|✕|✖|⨯/i.test(meta)) return true;
      const txt = (el.textContent ?? '').trim();
      if (/^[×✕✖⨯xX✗]$/.test(txt)) return true;
      return el.hasAttribute('data-dismiss') || el.hasAttribute('data-close');
    };
    let count = 0;
    for (const modal of modals) {
      const candidates = Array.from(modal.querySelectorAll('button, a, [role="button"], span, i, svg')).filter(isVisible);
      let target = candidates.find(looksLikeClose);
      if (!target) {
        // Fallback: small, text-less icon in the modal's top-right quadrant.
        const mr = modal.getBoundingClientRect();
        target = candidates.find((el) => {
          const r = el.getBoundingClientRect();
          const small = r.width < 70 && r.height < 70;
          const topRight = r.top < mr.top + mr.height * 0.3 && r.right > mr.right - mr.width * 0.3;
          const noText = (el.textContent ?? '').trim().length === 0;
          return small && topRight && noText;
        });
      }
      if (target) {
        const clickable = (target.closest('button, a, [role="button"]') as HTMLElement) ?? (target as HTMLElement);
        clickable.click();
        count += 1;
      }
    }
    return count > 0;
  }).catch(() => false);
  return closed;
}

/**
 * Auto-run dismissOverlays after every navigation/load. Cookie banners appear immediately
 * but newsletter/promo modals are often delayed several seconds, so we run several passes
 * on a schedule (not just once) to catch late popups without blocking the test.
 */
export function installOverlayAutoDismiss(page: Page): void {
  const delaysMs = (process.env.OVERLAY_RETRY_MS ?? '600,2500,5000,8000')
    .split(',').map((value) => Number(value.trim())).filter((value) => value >= 0);
  let running = false;

  const sweep = async () => {
    if (running) return;
    running = true;
    try { await dismissOverlays(page); } catch { /* navigated away */ } finally { running = false; }
  };

  const schedule = () => {
    for (const delay of delaysMs) {
      setTimeout(() => { void sweep(); }, delay);
    }
  };

  page.on('load', schedule);
  page.on('domcontentloaded', schedule);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
