import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { appConfig } from '../config.js';
import type { DiscoveredPage, WebsiteMap } from '../types.js';
import { readJson } from '../utils/fs.js';
import { createLogger } from '../utils/logger.js';
import { crawlWebsite } from './crawler.js';

const log = createLogger('pageList');
const mapPath = join(appConfig.reportsDir, 'website-map.json');

/**
 * Shared page source for tagged suites. Reuses reports/website-map.json when
 * fresh (< 24h) so suites don't re-crawl; otherwise runs a bounded crawl.
 */
export async function getPagesForSuite(limit = appConfig.maxPages): Promise<DiscoveredPage[]> {
  if (existsSync(mapPath)) {
    try {
      const map = await readJson<WebsiteMap>(mapPath);
      const ageMs = Date.now() - new Date(map.generatedAt).getTime();
      if (map.pages.length > 0 && ageMs < 24 * 60 * 60 * 1000) {
        log.info(`Reusing website map (${map.pages.length} pages, ${Math.round(ageMs / 60000)}m old).`);
        return applyIncremental(prioritize(map.pages)).slice(0, limit);
      }
    } catch {
      log.warn('Could not read existing website map; re-crawling.');
    }
  }
  const map = await crawlWebsite();
  return applyIncremental(prioritize(map.pages)).slice(0, limit);
}

/** INCREMENTAL=1 → validate only pages whose content changed since the last crawl
 *  (falls back to all pages when nothing changed, so suites never run empty). */
function applyIncremental(pages: DiscoveredPage[]): DiscoveredPage[] {
  if (process.env.INCREMENTAL !== '1') return pages;
  const changed = pages.filter((page) => page.changed !== false);
  if (changed.length === 0) {
    log.info('Incremental mode: no changed pages detected — validating full set.');
    return pages;
  }
  log.info(`Incremental mode: validating ${changed.length}/${pages.length} changed page(s).`);
  return changed;
}

/** Order pages so high-business-value categories are validated first. */
function prioritize(pages: DiscoveredPage[]): DiscoveredPage[] {
  const rank: Record<string, number> = {
    home: 0, product: 1, category: 2, landing: 3, checkout: 4, cart: 5,
    search: 6, blog: 7, support: 8, login: 9, account: 10, legal: 11, other: 12
  };
  return [...pages].sort((a, b) => (rank[a.category ?? 'other'] ?? 12) - (rank[b.category ?? 'other'] ?? 12) || a.depth - b.depth);
}
