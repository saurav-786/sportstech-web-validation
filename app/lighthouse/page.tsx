import { ExternalLink, Gauge } from 'lucide-react';
import { PageHeading } from '@/components/page-heading';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getDashboardSnapshot } from '@/lib/dashboard/data';

export const dynamic = 'force-dynamic';

export default async function LighthousePage() {
  const snapshot = await getDashboardSnapshot();
  const scores = [
    ['Mobile Performance', snapshot.scores.lighthouse.mobilePerformance],
    ['Desktop Performance', snapshot.scores.lighthouse.desktopPerformance],
    ['Accessibility', snapshot.scores.lighthouse.accessibility],
    ['Best Practices', snapshot.scores.lighthouse.bestPractices],
    ['SEO', snapshot.scores.lighthouse.seo],
  ] as const;
  return (
    <>
      <PageHeading title="Lighthouse Intelligence" description="Desktop and mobile Lighthouse categories parsed from the latest audit artifacts." actions={<a href="/api/artifacts/reports/lighthouse-report.html" target="_blank"><Button><ExternalLink size={13}/>Detailed report</Button></a>}/>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {scores.map(([label, value]) => <Card key={label} className="p-5"><Gauge className={value === null ? 'text-slate-300' : value >= 90 ? 'text-emerald-600' : value >= 50 ? 'text-orange-500' : 'text-red-600'}/><div className="mt-5 text-4xl font-extrabold tracking-tight text-slate-900">{value ?? '—'}</div><div className="mt-1 text-xs font-semibold text-slate-500">{label}</div>{value === null && <p className="mt-3 text-[10px] leading-4 text-slate-400">Run the Lighthouse audit to publish this score.</p>}</Card>)}
      </div>
      <Card className="mt-4 p-5"><h2 className="text-sm font-bold text-slate-800">Source status</h2><div className="mt-3 space-y-2">{snapshot.sourceNotes.filter((note) => note.toLowerCase().includes('lighthouse')).map((note) => <p key={note} className="text-xs leading-5 text-slate-600">{note}</p>)}</div></Card>
    </>
  );
}
