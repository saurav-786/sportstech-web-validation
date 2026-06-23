/**
 * Revenue model inputs. Estimates are available only when a complete, explicit
 * business dataset is connected. Automation results never invent AOV/sessions/CR.
 */
import type { AnalyticsRecord, RevenueAssumptions } from '../types.js';

export function resolveAssumptions(
  analytics: AnalyticsRecord[] = [],
  connected?: RevenueAssumptions,
): RevenueAssumptions {
  if (connected?.connected) return connected;
  const totalVisits = analytics.reduce((sum, a) => sum + (a.visits ?? 0), 0);
  const crValues = analytics.map((a) => a.conversionRate).filter((v): v is number => typeof v === 'number' && v > 0);
  const baselineConversionRate = crValues.length
    ? crValues.reduce((a, b) => a + b, 0) / crValues.length / 100
    : undefined;

  // Page analytics generally lacks AOV, so it is not enough to estimate money.
  return {
    averageOrderValueEur: connected?.averageOrderValueEur,
    dailySessions: totalVisits > 0 ? totalVisits : connected?.dailySessions,
    baselineConversionRate: baselineConversionRate ?? connected?.baselineConversionRate,
    source: 'unavailable',
    connected: false,
    sourceLabel: analytics.length ? 'analytics export (incomplete)' : undefined,
    disclaimer: 'Business revenue estimate unavailable because live Shopware/analytics data is not connected.',
  };
}
