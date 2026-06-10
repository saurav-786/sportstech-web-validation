import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { appConfig } from '../config.js';
import type { AnalyticsRecord } from '../types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('analytics');

/**
 * Imports traffic data from CSV or JSON exports (GA4, Search Console, server logs).
 * CSV columns (header names, case-insensitive, flexible order):
 *   url, impressions, visits|sessions|clicks, ctr, bounceRate|bounce_rate, conversionRate|conversion_rate
 * JSON: array of objects with the same keys.
 * Returns [] when no file is configured — the framework degrades gracefully.
 */
export async function loadAnalytics(path = appConfig.analyticsDataPath): Promise<AnalyticsRecord[]> {
  if (!path || !existsSync(path)) {
    log.info(`No analytics file at "${path}" — traffic weighting disabled (all pages weight 1).`);
    return [];
  }
  const raw = await readFile(path, 'utf8');
  const rows = path.endsWith('.json') ? parseJson(raw) : parseCsv(raw);
  const records = rows.map(toRecord).filter((record): record is AnalyticsRecord => record !== null);
  log.info(`Loaded ${records.length} analytics record(s) from ${path}.`);
  return records;
}

function parseJson(raw: string): Array<Record<string, string | number>> {
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : data.rows ?? [];
  } catch {
    log.warn('Invalid analytics JSON; ignoring.');
    return [];
  }
}

function parseCsv(raw: string): Array<Record<string, string | number>> {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((header) => header.toLowerCase().replace(/[^a-z]/g, ''));
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  });
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') inQuotes = !inQuotes;
    else if (char === ',' && !inQuotes) { cells.push(current.trim()); current = ''; }
    else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function toRecord(row: Record<string, string | number>): AnalyticsRecord | null {
  const get = (...keys: string[]) => {
    for (const key of keys) {
      const value = row[key] ?? row[key.toLowerCase().replace(/[^a-z]/g, '')];
      if (value !== undefined && value !== '') return Number(String(value).replace(/[%,]/g, ''));
    }
    return undefined;
  };
  const url = String(row.url ?? row.page ?? row.pagepath ?? '').trim();
  if (!url) return null;
  const impressions = get('impressions');
  const visits = get('visits', 'sessions', 'clicks', 'pageviews');
  const ctr = get('ctr');
  const bounceRate = get('bounceRate', 'bouncerate');
  const conversionRate = get('conversionRate', 'conversionrate');
  return { url, impressions, visits, ctr, bounceRate, conversionRate, weight: computeWeight({ impressions, visits, ctr, bounceRate, conversionRate }) };
}

/**
 * Traffic weight (1–10): log-scaled visits/impressions, boosted by CTR and conversion rate.
 * Multiplies severity in issue prioritization.
 */
function computeWeight(metrics: { impressions?: number; visits?: number; ctr?: number; bounceRate?: number; conversionRate?: number }): number {
  const volume = metrics.visits ?? metrics.impressions ?? 0;
  let weight = volume > 0 ? 1 + Math.min(Math.log10(volume + 1) * 1.8, 7) : 1;
  if ((metrics.conversionRate ?? 0) > 1) weight *= 1.2;
  if ((metrics.ctr ?? 0) > 5) weight *= 1.1;
  return Math.min(Math.round(weight * 10) / 10, 10);
}
