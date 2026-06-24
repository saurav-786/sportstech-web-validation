import { NextResponse } from 'next/server';
import { getDashboardSnapshot } from '@/lib/dashboard/data';
import type { DashboardNotification } from '@/lib/dashboard/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const snapshot = await getDashboardSnapshot().catch(() => null);
  const items: DashboardNotification[] = [];

  // No real notifications until at least one scan has produced data.
  if (snapshot && snapshot.hasData) {
    const time = snapshot.sourceGeneratedAt;
    const kpi = (key: string) => snapshot.kpis.find((metric) => metric.key === key)?.value ?? 0;

    const critical = Number(kpi('critical')) || 0;
    if (critical > 0) {
      items.push({ id: 'critical', severity: 'critical', title: `${critical} critical issues`, detail: 'Blocking release readiness in the latest scan.', time });
    }

    const failedPdp = Number(kpi('failed-pdp')) || 0;
    if (failedPdp > 0) {
      items.push({ id: 'failed-pdp', severity: 'warning', title: `${failedPdp} failing product pages`, detail: 'Add-to-cart failed on at least one device profile.', time });
    }

    if (snapshot.execution.testsFailed > 0) {
      items.push({ id: 'tests-failed', severity: 'warning', title: `${snapshot.execution.testsFailed} automation tests failed`, detail: `${snapshot.execution.testsPassed}/${snapshot.execution.testsTotal} passed in the latest run.`, time });
    }

    if (snapshot.dataFreshness === 'stale') {
      items.push({ id: 'stale', severity: 'info', title: 'Scan data is stale', detail: 'Run a new scan to refresh the dashboard.', time });
    }
  }

  return NextResponse.json({ count: items.length, items }, {
    headers: { 'cache-control': 'private, max-age=0, s-maxage=20, stale-while-revalidate=60' },
  });
}
