/**
 * pdpUrls.ts — PDP URL source for the fast @pdp-cart-fast add-to-cart suite.
 *
 * URL resolution order (first match wins):
 *   1. PDP_LIST env  — comma/newline separated URLs (ad-hoc runs, never cached).
 *   2. Cache file     — test-data/pdp-cart-urls.json (fast: no re-discovery).
 *   3. Discovery JSON — reports/pdp-discovery.json (rebuilds + writes the cache).
 *
 * The cache means we don't pay the discovery cost on every run. Refresh it with
 * REFRESH_PDP_URLS=true (re-reads the discovery JSON and rewrites the cache), or
 * just re-run `npm run test:pdp-discovery` and then refresh.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface ProductRef {
  url: string;
  category?: string;
}

const REPORTS_DIR = process.env.REPORTS_DIR ?? 'reports';
const DISCOVERY_JSON = process.env.PDP_DISCOVERY_JSON ?? join(REPORTS_DIR, 'pdp-discovery.json');
const CACHE_FILE = process.env.PDP_URLS_CACHE ?? join('test-data', 'pdp-cart-urls.json');

interface DiscoveryShape {
  categories?: Record<string, string[]>;
}

interface CacheShape {
  generatedAt: string;
  source: string;
  count: number;
  products: ProductRef[];
}

function fromEnvList(): ProductRef[] | null {
  const raw = process.env.PDP_LIST?.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  return raw?.length ? raw.map((url) => ({ url })) : null;
}

function fromDiscovery(): ProductRef[] {
  if (!existsSync(DISCOVERY_JSON)) return [];
  try {
    const data = JSON.parse(readFileSync(DISCOVERY_JSON, 'utf8')) as DiscoveryShape;
    const out: ProductRef[] = [];
    const seen = new Set<string>();
    for (const [category, urls] of Object.entries(data.categories ?? {})) {
      for (const url of urls) {
        if (!seen.has(url)) {
          seen.add(url);
          out.push({ url, category });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

function readCache(): ProductRef[] | null {
  if (!existsSync(CACHE_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as CacheShape;
    return data.products?.length ? data.products : null;
  } catch {
    return null;
  }
}

function writeCache(products: ProductRef[]): void {
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    const payload: CacheShape = {
      generatedAt: new Date().toISOString(),
      source: DISCOVERY_JSON,
      count: products.length,
      products,
    };
    writeFileSync(CACHE_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch {
    /* cache is an optimization — never fail the run because we couldn't write it */
  }
}

/**
 * Resolve the PDP URLs to exercise. Reads the cache when present; rebuilds it
 * from the discovery JSON when missing or when REFRESH_PDP_URLS=true.
 */
export function loadPdpUrls(): ProductRef[] {
  const envList = fromEnvList();
  if (envList) return envList;

  const refresh = process.env.REFRESH_PDP_URLS === 'true' || process.env.REFRESH_PDP_URLS === '1';
  if (!refresh) {
    const cached = readCache();
    if (cached) return cached;
  }

  const fresh = fromDiscovery();
  if (fresh.length) writeCache(fresh);
  return fresh;
}

/** Last path segment of a PDP URL — a stable, readable test label. */
export function slug(url: string): string {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).pop() ?? url;
  } catch {
    return url;
  }
}
