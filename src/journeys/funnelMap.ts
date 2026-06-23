/**
 * funnelMap.ts — maps URLs and page categories to ecommerce FunnelStages.
 * Reuses the existing categorizeUrl rules (src/utils/url.ts) so there is a single
 * source of truth for what a URL "is".
 */

import { appConfig } from '../config.js';
import type { FunnelStage, PageCategory } from '../types.js';
import { categorizeUrl } from '../utils/url.js';

const CATEGORY_TO_STAGE: Partial<Record<PageCategory, FunnelStage>> = {
  home: 'discovery',
  category: 'discovery',
  search: 'discovery',
  landing: 'discovery',
  product: 'product-view',
  cart: 'cart',
  checkout: 'checkout',
};

/** Best-effort funnel stage for a URL. Defaults to 'discovery'. */
export function funnelStageForUrl(url: string, baseUrl = appConfig.baseUrl): FunnelStage {
  let category: PageCategory;
  try {
    category = categorizeUrl(url, baseUrl);
  } catch {
    return 'discovery';
  }
  // Payment pages frequently share the /checkout path; detect explicit payment hints.
  if (/payment|zahlung|pay\b|kreditkarte|paypal|adyen|stripe/i.test(url)) return 'payment';
  if (/success|danke|thank-you|order-confirm|bestellbestaetigung/i.test(url)) return 'order-complete';
  return CATEGORY_TO_STAGE[category] ?? 'discovery';
}

export const STAGE_LABEL: Record<FunnelStage, string> = {
  'discovery': 'Discovery',
  'product-view': 'Product View',
  'add-to-cart': 'Add to Cart',
  'cart': 'Cart',
  'checkout': 'Checkout',
  'payment': 'Payment',
  'order-complete': 'Order Complete',
};
