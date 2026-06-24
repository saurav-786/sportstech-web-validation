import { Bot, CheckCircle2, TriangleAlert } from 'lucide-react';
import { RcaBars } from '@/components/dashboard-charts';
import { PageHeading } from '@/components/page-heading';
import { Panel } from '@/components/panel';
import { Card } from '@/components/ui/card';
import { getDashboardSnapshot } from '@/lib/dashboard/data';

export const dynamic = 'force-dynamic';

export default async function AiRcaPage() {
  const snapshot = await getDashboardSnapshot();
  const rcaFindings = snapshot.findings.filter((item) => item.confidence || item.rootCause);
  const hasRca = snapshot.rcaDistribution.length > 0 || rcaFindings.length > 0;

  if (!hasRca) {
    return (
      <>
        <PageHeading title="AI Root Cause Analysis" description="Evidence-grounded classifications from the deterministic analyzer and optional AI provider."/>
        <Card className="grid place-items-center px-6 py-20 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-violet-50 text-violet-600"><Bot size={26}/></div>
          <h2 className="mt-5 text-lg font-bold text-slate-800">No RCA data available yet</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">Run a scan to generate RCA insights. Root-cause classifications and recommendations will appear here once a scan produces findings.</p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeading title="AI Root Cause Analysis" description="Evidence-grounded classifications from the deterministic analyzer and optional AI provider. Confidence and recommendations are preserved from source artifacts."/>
      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <Panel title="RCA Category Distribution" subtitle="All current findings" className="h-[420px]"><div className="h-[365px] p-3"><RcaBars data={snapshot.rcaDistribution}/></div></Panel>
        <div className="space-y-3">
          {snapshot.findings.filter((item) => item.confidence || item.rootCause).slice(0, 12).map((finding) => (
            <Card key={finding.id} className="p-4">
              <div className="flex gap-3">
                <div className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${finding.severity === 'critical' || finding.severity === 'P0' ? 'bg-red-50 text-red-600' : 'bg-violet-50 text-violet-600'}`}>{finding.severity === 'critical' ? <TriangleAlert size={17}/> : <Bot size={17}/>}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-sm font-bold text-slate-800">{finding.issueType}</h2><span className="rounded bg-slate-100 px-2 py-0.5 text-[9px] font-semibold text-slate-500">{finding.confidence ?? '—'}% confidence</span><span className="text-[10px] text-slate-400">{finding.pageUrl}</span></div>
                  <p className="mt-2 text-xs leading-5 text-slate-600">{finding.rootCause}</p>
                  {finding.recommendation && <p className="mt-2 flex gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-[11px] leading-4 text-emerald-800"><CheckCircle2 size={14} className="mt-0.5 shrink-0"/>{finding.recommendation}</p>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
