import { EvidenceView } from '@/components/evidence-view';
import { getDashboardSnapshot } from '@/lib/dashboard/data';

export const dynamic = 'force-dynamic';

export default async function EvidencePage() {
  return <EvidenceView evidence={(await getDashboardSnapshot()).evidence}/>;
}
