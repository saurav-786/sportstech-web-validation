import { CircleDollarSign, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Donut, RiskBars } from '@/components/dashboard-charts';
import { PageHeading } from '@/components/page-heading';
import { Panel } from '@/components/panel';
import { Card } from '@/components/ui/card';
import { getDashboardSnapshot } from '@/lib/dashboard/data';

export const dynamic = 'force-dynamic';

export default async function RevenueAnalyticsPage() {
  const snapshot = await getDashboardSnapshot();
  return (
    <>
      <PageHeading title="Revenue Analytics" description="Purchase-funnel quality and revenue-risk intelligence. Monetary loss remains unavailable until a complete verified business dataset is connected."/>
      {!snapshot.businessDataConnected && <div className="mb-4 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><TriangleAlert size={17} className="shrink-0"/><span><strong>Business metrics not connected.</strong> Risk ranking uses automation evidence and affected-page counts; the dashboard does not fabricate euro loss.</span></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5"><CircleDollarSign className="text-indigo-600"/><div className="mt-4 text-3xl font-extrabold text-slate-900">{snapshot.kpis.find((item) => item.key === 'revenue')?.display}</div><div className="text-xs font-semibold text-slate-500">Revenue-risk pages</div></Card>
        <Card className="p-5"><ShieldCheck className="text-emerald-600"/><div className="mt-4 text-3xl font-extrabold text-slate-900">{snapshot.kpis.find((item) => item.key === 'cart')?.display}</div><div className="text-xs font-semibold text-slate-500">PDP/cart check pass rate</div></Card>
        <Card className="p-5"><TriangleAlert className="text-orange-600"/><div className="mt-4 text-3xl font-extrabold text-slate-900">{snapshot.scores.conversionRisk ?? '—'}%</div><div className="text-xs font-semibold text-slate-500">Conversion risk score</div></Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Affected Categories" subtitle="Revenue-risk findings by product category" className="h-[380px]"><div className="h-[325px] p-3"><RiskBars data={snapshot.revenueRiskDistribution}/></div></Panel>
        <Panel title="PDP Discovery Coverage" subtitle="Discovered product URLs by category" className="h-[380px]"><div className="h-[325px] p-3"><Donut data={snapshot.categoryDistribution} centerLabel="URLs"/></div></Panel>
      </div>
    </>
  );
}
