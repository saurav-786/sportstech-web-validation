import { NextResponse } from 'next/server';
import { getDashboardSnapshot } from '@/lib/dashboard/data';
import type { ReportItem } from '@/lib/dashboard/types';

export const dynamic = 'force-dynamic';

/**
 * Returns the newest available report of each downloadable type from the latest
 * completed scan, so the header "Generate Report" / "Download PDF" actions can
 * link to real artifacts — or surface an honest "no report" message.
 */
export async function GET() {
  const snapshot = await getDashboardSnapshot().catch(() => null);
  const reports: ReportItem[] = snapshot?.reports ?? [];

  const newest = (type: ReportItem['type']) =>
    reports
      .filter((report) => report.type === type)
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))[0] ?? null;

  const pdf = newest('PDF');
  const html = newest('HTML');
  const json = newest('JSON');
  const csv = newest('CSV');

  return NextResponse.json({
    available: Boolean(pdf || html || json || csv),
    pdf,
    html,
    json,
    csv,
  });
}
