import { WebsiteTestingView } from '@/components/website-testing-view';
import { getDashboardSnapshot } from '@/lib/dashboard/data';

export const dynamic = 'force-dynamic';

export default async function WebsiteTestingPage() {
  return <WebsiteTestingView snapshot={await getDashboardSnapshot()}/>;
}
