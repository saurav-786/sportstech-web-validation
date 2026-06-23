/**
 * media.ts — PDP media auditor (Phase 2/5 add-on).
 *
 * Enumerates every image and video (incl. <source> mp4/webm and posters) on a
 * product page, measures the actual bytes transferred via the Resource Timing
 * API, and flags oversized or broken assets. Runs per form factor (mobile vs
 * desktop) with different byte budgets, because mobile shoppers pay for weight
 * in load time and data. Emits standard ValidationIssue[] so results flow into
 * the existing scoring/dashboard pipeline.
 */
import type { Page } from '@playwright/test';
import { appConfig } from '../config.js';
import type { MediaAsset, MediaPageResult, ValidationIssue } from '../types.js';
import { issue } from './common.js';

function extOf(url: string): string {
  const m = url.split('?')[0].match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : '';
}

/** Scroll the page to force lazy media to load, then read inventory + sizes in-page. */
export async function collectMedia(page: Page): Promise<{ images: MediaAsset[]; videos: MediaAsset[] }> {
  await page.evaluate(async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 12; i += 1) { window.scrollBy(0, window.innerHeight); await delay(300); }
    window.scrollTo({ top: 0 });
    await delay(400);
  }).catch(() => undefined);

  return page.evaluate(() => {
    // Map of URL -> bytes from Resource Timing.
    const timing = new Map<string, number>();
    for (const r of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
      const bytes = r.encodedBodySize || r.transferSize || 0;
      if (bytes > 0) timing.set(r.name, bytes);
    }
    const sizeFor = (url: string): number | undefined => timing.get(url);

    const images = Array.from(document.images).map((img) => {
      const url = img.currentSrc || img.src;
      return {
        kind: 'image' as const,
        url,
        bytes: sizeFor(url),
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        displayWidth: Math.round(img.getBoundingClientRect().width),
        displayHeight: Math.round(img.getBoundingClientRect().height),
        broken: img.complete && img.naturalWidth === 0,
        notDownloaded: sizeFor(url) === undefined,
      };
    }).filter((a) => a.url);

    const videos: Array<Record<string, unknown>> = [];
    for (const v of Array.from(document.querySelectorAll('video'))) {
      const el = v as HTMLVideoElement;
      const directSrc = el.currentSrc || el.src;
      const sources = Array.from(el.querySelectorAll('source')).map((s) => (s as HTMLSourceElement).src).filter(Boolean);
      const urls = [directSrc, ...sources].filter(Boolean);
      for (const url of urls) {
        videos.push({
          kind: url === directSrc ? 'video' : 'source',
          url,
          bytes: sizeFor(url),
          durationSec: Number.isFinite(el.duration) ? Math.round(el.duration) : undefined,
          poster: el.poster || undefined,
          preload: el.preload || undefined,
          broken: el.error != null || el.readyState === 0,
          notDownloaded: sizeFor(url) === undefined,
        });
      }
    }
    return { images, videos: videos as unknown as MediaAsset[] };
  });
}

export function mediaToIssues(
  url: string,
  formFactor: 'mobile' | 'desktop',
  device: string,
  assets: { images: MediaAsset[]; videos: MediaAsset[] },
): MediaPageResult {
  const cfg = appConfig.revenue.media;
  const imgMaxKb = formFactor === 'mobile' ? cfg.imageMaxKbMobile : cfg.imageMaxKbDesktop;
  const vidMaxMb = formFactor === 'mobile' ? cfg.videoMaxMbMobile : cfg.videoMaxMbDesktop;
  const issues: ValidationIssue[] = [];

  for (const img of assets.images) {
    img.format = extOf(img.url);
    if (img.broken) {
      issues.push({ ...issue('image', 'high', url, `Broken product image on ${formFactor}: ${img.url}`, 'Fix the image source — broken media erodes trust and conversion.', img.url), device });
      continue;
    }
    const kb = img.bytes ? Math.round(img.bytes / 1024) : undefined;
    if (kb && kb > imgMaxKb) {
      issues.push({ ...issue('image', kb > imgMaxKb * 2 ? 'high' : 'medium', url,
        `Oversized image (${kb}KB > ${imgMaxKb}KB ${formFactor} budget): ${img.url}`,
        `Serve a smaller/next-gen image (WebP/AVIF), responsive srcset, and compress.`, img.url),
        area: 'performance', device, funnelStage: 'product-view' });
    }
    // Oversized intrinsic dimensions vs display (wasted download).
    if (img.naturalWidth && img.displayWidth && img.displayWidth > 0 && img.naturalWidth > img.displayWidth * 2.5) {
      issues.push({ ...issue('performance', 'low', url,
        `Image served at ${img.naturalWidth}px but displayed at ${img.displayWidth}px on ${formFactor}: ${img.url}`,
        'Use responsive srcset/sizes so devices download appropriately-sized images.', img.url), device, funnelStage: 'product-view' });
    }
  }

  for (const vid of assets.videos) {
    vid.format = extOf(vid.url);
    if (vid.broken) {
      issues.push({ ...issue('ui', 'high', url, `Broken/failed video on ${formFactor}: ${vid.url}`, 'Fix the video source/encoding or readyState; verify it plays.', vid.url), device, funnelStage: 'product-view' });
    }
    const mb = vid.bytes ? vid.bytes / (1024 * 1024) : undefined;
    if (mb && mb > vidMaxMb) {
      issues.push({ ...issue('performance', mb > vidMaxMb * 2 ? 'high' : 'medium', url,
        `Heavy video (${mb.toFixed(1)}MB > ${vidMaxMb}MB ${formFactor} budget): ${vid.url}`,
        'Compress/transcode, lower bitrate for mobile, lazy-load with preload="none", or use a poster + click-to-play.', vid.url),
        device, funnelStage: 'product-view' });
    }
    if (vid.kind === 'video' && !vid.poster) {
      issues.push({ ...issue('performance', 'low', url, `Video without poster on ${formFactor}: ${vid.url}`,
        'Add a poster image to avoid a blank frame and reduce perceived load time.', vid.url), device, funnelStage: 'product-view' });
    }
  }

  const totalImageBytes = assets.images.reduce((s, a) => s + (a.bytes ?? 0), 0);
  const totalVideoBytes = assets.videos.reduce((s, a) => s + (a.bytes ?? 0), 0);

  return { url, formFactor, device, images: assets.images, videos: assets.videos, totalImageBytes, totalVideoBytes, issues };
}
