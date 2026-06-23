import { ReportsView } from '@/components/reports-view';
import { getDashboardSnapshot } from '@/lib/dashboard/data';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  return <ReportsView reports={(await getDashboardSnapshot()).reports}/>;
}
