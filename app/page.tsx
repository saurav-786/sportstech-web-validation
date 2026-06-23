import { LiveDashboard } from '@/components/live-dashboard';
import { getDashboardSnapshot } from '@/lib/dashboard/data';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const snapshot = await getDashboardSnapshot();
  return <LiveDashboard initialSnapshot={snapshot}/>;
}
