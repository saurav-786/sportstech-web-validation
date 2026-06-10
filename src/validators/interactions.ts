import type { APIRequestContext, Page } from '@playwright/test';
import { appConfig } from '../config.js';
import type { ValidationIssue } from '../types.js';
import { issue } from './common.js';

export async function validateLinks(request: APIRequestContext, page: Page, pageUrl: string): Promise<ValidationIssue[]> {
  const hrefs = await page.locator('a[href]').evaluateAll((anchors, limit) =>
    Array.from(new Set(anchors.map((anchor) => (anchor as HTMLAnchorElement).href).filter(Boolean))).slice(0, limit)
  , appConfig.maxLinkChecks
  );
  const issues: ValidationIssue[] = [];

  for (const href of hrefs) {
    if (href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    const response = await request.get(href, { timeout: 5_000, maxRedirects: 8 }).catch(() => null);
    if (!response) {
      issues.push(issue('ui', 'medium', pageUrl, `Link did not respond: ${href}`, 'Fix the destination URL or remove the broken link.', href));
      continue;
    }
    if (response.status() >= 400) {
      issues.push(issue('ui', response.status() >= 500 ? 'high' : 'medium', pageUrl, `Broken link ${href} returned ${response.status()}.`, 'Fix the destination route, redirect, or linked content.', href));
    }
  }

  return issues;
}

export async function validateClickableControls(page: Page, pageUrl: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const controls = page.locator('button:visible, [role="button"]:visible, input[type="button"]:visible, input[type="submit"]:visible');
  const count = Math.min(await controls.count().catch(() => 0), appConfig.maxControlChecks);

  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    const label = await control.innerText().catch(async () => await control.getAttribute('aria-label').catch(() => `control ${index + 1}`));
    await control.click({ trial: true, timeout: 2_500 }).catch(() => {
      issues.push(issue('ui', 'medium', pageUrl, `Visible button is not clickable: ${label || `control ${index + 1}`}`, 'Ensure visible controls are enabled, unobstructed, and have stable dimensions.'));
    });
  }

  return issues;
}

export async function validateMediaAndCarousels(page: Page, pageUrl: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const videos = await page.locator('video').evaluateAll((nodes) => nodes.map((video) => ({
    src: (video as HTMLVideoElement).currentSrc || (video as HTMLVideoElement).src,
    readyState: (video as HTMLVideoElement).readyState,
    error: (video as HTMLVideoElement).error?.message ?? ''
  }))).catch(() => []);

  for (const video of videos) {
    if (video.error || (video.src && video.readyState === 0)) {
      issues.push(issue('ui', 'medium', pageUrl, `Video may not be playable: ${video.src}`, 'Validate the video source, MIME type, poster, and CDN response.', video.src));
    }
  }

  const carouselControls = page.locator('[class*="carousel"] button:visible, [class*="slider"] button:visible, .swiper-button-next:visible, .swiper-button-prev:visible');
  const count = Math.min(await carouselControls.count().catch(() => 0), 10);
  for (let index = 0; index < count; index += 1) {
    await carouselControls.nth(index).click({ trial: true, timeout: 2_000 }).catch(() => {
      issues.push(issue('ui', 'low', pageUrl, 'Carousel or slider control is not actionable.', 'Check carousel initialization, overlay layering, and disabled state logic.'));
    });
  }

  return issues;
}

export async function validatePopups(page: Page, pageUrl: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const dialogs = page.locator('dialog:visible, [role="dialog"]:visible, .modal:visible, .popup:visible, [class*="newsletter"]:visible, [class*="cookie"]:visible');
  const count = Math.min(await dialogs.count().catch(() => 0), 10);

  for (let index = 0; index < count; index += 1) {
    const dialog = dialogs.nth(index);
    const hasAccessibleName = Boolean(await dialog.getAttribute('aria-label').catch(() => null))
      || Boolean(await dialog.getAttribute('aria-labelledby').catch(() => null));
    if (!hasAccessibleName) {
      issues.push(issue('popup', 'medium', pageUrl, 'Visible popup/modal lacks an accessible name.', 'Add aria-label or aria-labelledby to modal containers.'));
    }

    const close = dialog.locator('button[aria-label*="close" i], button[aria-label*="schließen" i], button:has-text("×"), button:has-text("Close"), button:has-text("Schließen")').first();
    if (!await close.isVisible().catch(() => false)) {
      issues.push(issue('popup', 'high', pageUrl, 'Visible popup/modal has no obvious close button.', 'Provide a visible keyboard-accessible close control.'));
    } else {
      await close.click({ trial: true, timeout: 2_000 }).catch(() => {
        issues.push(issue('popup', 'high', pageUrl, 'Popup close control is not clickable.', 'Ensure close control is enabled and not blocked by overlays.'));
      });
    }
  }

  return issues;
}
