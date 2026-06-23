/**
 * Optional verified business metrics integration.
 *
 * No defaults are invented. A usable dataset must contain sessions, conversion
 * rate, and AOV from an explicitly configured API, JSON file, or environment.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { RevenueAssumptions } from '../types.js';

interface RawBusinessMetrics {
  dailySessions?: number;
  sessionsPerDay?: number;
  averageOrderValueEur?: number;
  aovEur?: number;
  baselineConversionRate?: number;
  conversionRate?: number;
  source?: RevenueAssumptions['source'];
  sourceLabel?: string;
}

export async function loadBusinessMetrics(): Promise<RevenueAssumptions | undefined> {
  const apiUrl = process.env.REVENUE_BUSINESS_METRICS_URL
    ?? process.env.SHOPWARE_ANALYTICS_URL
    ?? process.env.GA_METRICS_URL
    ?? process.env.CLARITY_METRICS_URL;

  if (apiUrl) {
    const response = await fetch(apiUrl, {
      headers: process.env.REVENUE_BUSINESS_METRICS_TOKEN
        ? { authorization: `Bearer ${process.env.REVENUE_BUSINESS_METRICS_TOKEN}` }
        : undefined,
    });
    if (!response.ok) throw new Error(`Business metrics API returned HTTP ${response.status}`);
    return normalize(await response.json() as RawBusinessMetrics, 'shopware', apiUrl);
  }

  const path = process.env.REVENUE_BUSINESS_DATA_PATH;
  if (path && existsSync(path)) {
    return normalize(JSON.parse(await readFile(path, 'utf8')) as RawBusinessMetrics, 'manual', path);
  }

  const env: RawBusinessMetrics = {
    dailySessions: numeric(process.env.REVENUE_DAILY_SESSIONS),
    averageOrderValueEur: numeric(process.env.REVENUE_AOV_EUR),
    baselineConversionRate: numeric(process.env.REVENUE_BASELINE_CR),
  };
  if (env.dailySessions !== undefined || env.averageOrderValueEur !== undefined || env.baselineConversionRate !== undefined) {
    return normalize(env, 'environment', 'environment variables');
  }

  return undefined;
}

function normalize(
  raw: RawBusinessMetrics,
  fallbackSource: RevenueAssumptions['source'],
  sourceLabel: string,
): RevenueAssumptions {
  const dailySessions = positive(raw.dailySessions ?? raw.sessionsPerDay);
  const averageOrderValueEur = positive(raw.averageOrderValueEur ?? raw.aovEur);
  let baselineConversionRate = positive(raw.baselineConversionRate ?? raw.conversionRate);
  if (baselineConversionRate !== undefined && baselineConversionRate > 1) baselineConversionRate /= 100;
  const connected = dailySessions !== undefined && averageOrderValueEur !== undefined && baselineConversionRate !== undefined;

  return {
    dailySessions,
    averageOrderValueEur,
    baselineConversionRate,
    source: connected ? (raw.source ?? fallbackSource) : 'unavailable',
    connected,
    sourceLabel: raw.sourceLabel ?? sourceLabel,
    disclaimer: connected
      ? `Business estimates use explicitly connected data from ${raw.sourceLabel ?? sourceLabel}.`
      : 'Business revenue estimate unavailable because live Shopware/analytics data is not connected.',
  };
}

function numeric(value?: string): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positive(value?: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}
