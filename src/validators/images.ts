import type { Page } from '@playwright/test';
import type { ValidationIssue } from '../types.js';
import { issue } from './common.js';

export async function validateImages(page: Page, pageUrl: string): Promise<ValidationIssue[]> {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll<HTMLImageElement>('img')).map((image) => ({
      src: image.currentSrc || image.src,
      alt: image.getAttribute('alt'),
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      loading: image.loading,
      width: image.clientWidth,
      height: image.clientHeight
    }));
  }).then((images) => images.flatMap((imageInfo) => {
    const issues = [];
    if (!imageInfo.src) {
      issues.push(issue('image', 'medium', pageUrl, 'Image missing src attribute.', 'Provide a valid product, hero, or decorative image source.'));
    } else if (!imageInfo.complete || imageInfo.naturalWidth === 0) {
      issues.push(issue('image', 'high', pageUrl, `Broken image: ${imageInfo.src}`, 'Replace the missing asset or fix the CDN URL.', imageInfo.src));
    }

    if (imageInfo.alt === null) {
      issues.push(issue('image', 'medium', pageUrl, `Image missing alt attribute: ${imageInfo.src}`, 'Add meaningful alt text, or alt="" for decorative images.', imageInfo.src));
    }

    if ((imageInfo.width > 300 || imageInfo.height > 200) && imageInfo.loading !== 'lazy') {
      issues.push(issue('performance', 'low', pageUrl, `Large image is not lazy-loaded: ${imageInfo.src}`, 'Use loading="lazy" for non-critical below-the-fold imagery.', imageInfo.src));
    }

    return issues;
  }));
}
