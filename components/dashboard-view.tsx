'use client';

import {
  Bot,
  Box,
  Clock3,
  ExternalLink,
  FileCheck2,
  Image as ImageIcon,
  MonitorSmartphone,
  Search,
  ShieldAlert,
  Sparkles,
  Timer,
  Video,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DashboardSnapshot } from '@/lib/dashboard/types';
import { formatDate } from '@/lib/utils';
import { AddToCartTrend, Donut, Gauge, HealthTrend, RcaBars, RiskBars } from './dashboard-charts';
import { KpiCard } from './kpi-card';
import { Panel } from './panel';
import { Button } from './ui/button';
import { Card } from './ui/card';

const severityClass: Record<string, string> = {
  critical: 'border-red-200 bg-red-50 text-red-700',
  P0: 'border-red-200 bg-red-50 text-red-700',
  high: 'border-orange-200 bg-orange-50 text-orange-700',
  P1: 'border-orange-200 bg-orange-50 text-orange-700',
  medium: 'border-violet-200 bg-violet-50 text-violet-700',
  P2: 'border-violet-200 bg-violet-50 text-violet-700',
  low: 'border-blue-200 bg-blue-50 text-blue-700',
  P3: 'border-blue-200 bg-blue-50 text-blue-700',
  info: 'border-slate-200 bg-slate-50 text-slate-600',
};

const statusClass: Record<string, string> = {
  Open: 'border-red-200 bg-red-50 text-red-700',
  Investigating: 'border-orange-200 bg-orange-50 text-orange-700',
  Fixed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  Monitoring: 'border-blue-200 bg-blue-50 text-blue-700',
  Backlog: 'border-slate-200 bg-slate-50 text-slate-600',
};

function EmptyChart({ text }: { text: string }) {
  return <div className="grid h-full place-items-center px-5 text-center text-xs text-slate-400">{text}</div>;
}

function ExecutionRow({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-slate-100 py-2 last:border-0">
      <Icon size={13} className="text-indigo-500"/>
      <span className="flex-1 text-[10px] text-slate-500">{label}</span>
      <strong className="text-[10px] font-semibold text-slate-700">{value}</strong>
    </div>
  );
}

export function DashboardView({ snapshot }: { snapshot: DashboardSnapshot }) {
  const [query, setQuery] = useState('');
  const findings = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return snapshot.findings.slice(0, 8);
    return snapshot.findings.filter((item) =>
      `${item.pageUrl} ${item.category} ${item.issueType} ${item.rootCause}`.toLowerCase().includes(search),
    ).slice(0, 12);
  }, [query, snapshot.findings]);

  return (
    <div className="space-y-3.5">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {snapshot.kpis.map((metric) => <KpiCard key={metric.key} metric={metric}/>)}
      </section>

      <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_335px]">
        <div className="space-y-3.5">
          <div className="grid gap-3.5 lg:grid-cols-12">
            <Panel title="Website Health Trend" subtitle={`${snapshot.trends.length} recorded execution snapshots`} className="h-[255px] lg:col-span-5">
              <div className="h-[205px] px-2 pb-2">{snapshot.trends.length ? <HealthTrend data={snapshot.trends}/> : <EmptyChart text="Historical revenue-health artifacts will populate this trend."/ >}</div>
            </Panel>
            <Panel title="Add-to-Cart Failure Trend" subtitle="Failure count and observed check success" className="h-[255px] lg:col-span-4">
              <div className="h-[205px] px-2 pb-2">{snapshot.addToCartTrends.length ? <AddToCartTrend data={snapshot.addToCartTrends}/> : <EmptyChart text="Run PDP cart automation to create a trend."/ >}</div>
            </Panel>
            <Panel title="Category Health Distribution" subtitle="Products discovered by category" className="h-[255px] lg:col-span-3">
              <div className="h-[205px] px-2 pb-2">{snapshot.categoryDistribution.length ? <Donut data={snapshot.categoryDistribution} centerLabel="URLs"/> : <EmptyChart text="No PDP discovery artifact found."/ >}</div>
            </Panel>
          </div>

          <div className="grid gap-3.5 lg:grid-cols-12">
            <Panel title="Issue Severity Distribution" subtitle="Deterministic issue output" className="h-[238px] lg:col-span-4">
              <div className="h-[188px] px-2 pb-2">{snapshot.severityDistribution.length ? <Donut data={snapshot.severityDistribution} centerLabel="Issues"/> : <EmptyChart text="No issue results found."/ >}</div>
            </Panel>
            <Panel title="Revenue Impact Analysis" subtitle={snapshot.businessDataConnected ? 'Verified connected business data' : 'Risk findings by category · monetary estimate disabled'} className="h-[238px] lg:col-span-4">
              <div className="h-[188px] px-2 pb-2">{snapshot.revenueRiskDistribution.length ? <RiskBars data={snapshot.revenueRiskDistribution}/> : <EmptyChart text="No revenue-risk findings were produced."/ >}</div>
            </Panel>
            <Panel title="AI RCA Categories" subtitle="Evidence-classified root-cause families" className="h-[238px] lg:col-span-4">
              <div className="h-[188px] px-1 pb-2">{snapshot.rcaDistribution.length ? <RcaBars data={snapshot.rcaDistribution}/> : <EmptyChart text="No RCA categories available."/ >}</div>
            </Panel>
          </div>
        </div>

        <aside className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-1">
          <Panel title="Executive Quality Overview" className="min-h-[255px]">
            <div className="grid grid-cols-2 gap-x-2 px-2 pb-2">
              <Gauge label="Website Quality Score" value={snapshot.scores.websiteQuality}/>
              <Gauge label="Conversion Risk" value={snapshot.scores.conversionRisk} inverse/>
              <Gauge label="Customer Experience" value={snapshot.scores.customerExperience}/>
              <Gauge label="Automation Coverage" value={snapshot.scores.automationCoverage}/>
            </div>
          </Panel>

          <Panel title="AI Insights" className="min-h-[196px]">
            <div className="space-y-2 px-3 pb-3 pt-1">
              {snapshot.insights.map((insight, index) => (
                <div key={insight} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 py-2 text-[10px] leading-4 text-slate-700">
                  {index === 0 ? <ShieldAlert size={14} className="mt-0.5 shrink-0 text-red-500"/> : index === 1 ? <MonitorSmartphone size={14} className="mt-0.5 shrink-0 text-indigo-500"/> : index === 2 ? <Bot size={14} className="mt-0.5 shrink-0 text-emerald-600"/> : <Sparkles size={14} className="mt-0.5 shrink-0 text-orange-500"/>}
                  {insight}
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Latest Execution" className="min-h-[220px]">
            <div className="px-3 pb-2 pt-1">
              <ExecutionRow icon={Clock3} label="Last Scan Time" value={formatDate(snapshot.execution.lastScanTime)}/>
              <ExecutionRow icon={Timer} label="Execution Time" value={`${Math.floor(snapshot.execution.totalExecutionTimeMs / 60000)}m ${Math.round((snapshot.execution.totalExecutionTimeMs % 60000) / 1000)}s`}/>
              <ExecutionRow icon={Box} label="Pages Crawled" value={snapshot.execution.pagesCrawled}/>
              <ExecutionRow icon={ImageIcon} label="Screenshots Indexed" value={snapshot.execution.screenshotsCaptured}/>
              <ExecutionRow icon={Video} label="Videos Generated" value={snapshot.execution.videosGenerated}/>
              <ExecutionRow icon={FileCheck2} label="Reports Generated" value={snapshot.execution.reportsGenerated}/>
            </div>
          </Panel>
        </aside>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="panel-title">Recent Findings</h2>
            <p className="mt-0.5 text-[9px] text-slate-500">Severity-ranked results from real scan and revenue artifacts</p>
          </div>
          <div className="relative ml-auto min-w-[220px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"/>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search URL or issue…" className="h-8 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-[10px] outline-none focus:border-indigo-400"/>
          </div>
          <a href="/evidence"><Button size="sm"><ExternalLink size={13}/>View Evidence</Button></a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] table-fixed text-left">
            <thead className="bg-slate-50">
              <tr className="border-b border-slate-200 text-[9px] font-semibold text-slate-500">
                <th className="w-[15%] px-4 py-2.5">Page URL</th>
                <th className="w-[9%] px-3 py-2.5">Category</th>
                <th className="w-[8%] px-3 py-2.5">Platform</th>
                <th className="w-[7%] px-3 py-2.5">Severity</th>
                <th className="w-[11%] px-3 py-2.5">Issue Type</th>
                <th className="w-[27%] px-3 py-2.5">AI Root Cause</th>
                <th className="w-[8%] px-3 py-2.5">Screenshot</th>
                <th className="w-[8%] px-3 py-2.5">Status</th>
                <th className="w-[7%] px-3 py-2.5">Owner</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((finding) => (
                <tr key={finding.id} className="border-b border-slate-100 text-[10px] text-slate-650 last:border-0 hover:bg-indigo-50/25">
                  <td className="truncate px-4 py-2.5 font-semibold text-blue-600" title={finding.pageUrl}>{finding.pageUrl}</td>
                  <td className="truncate px-3 py-2.5">{finding.category}</td>
                  <td className="truncate px-3 py-2.5">{finding.platform}</td>
                  <td className="px-3 py-2.5"><span className={`inline-flex rounded border px-2 py-0.5 text-[9px] font-semibold ${severityClass[finding.severity] ?? severityClass.info}`}>{finding.severity}</span></td>
                  <td className="truncate px-3 py-2.5 capitalize">{finding.issueType}</td>
                  <td className="truncate px-3 py-2.5" title={finding.rootCause}>{finding.rootCause}</td>
                  <td className="px-3 py-2.5">
                    {finding.screenshot ? (
                      <a href={`/api/artifacts/${finding.screenshot}`} target="_blank" className="inline-flex items-center gap-1 text-blue-600"><ImageIcon size={13}/>Open</a>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-2.5"><span className={`inline-flex rounded border px-2 py-0.5 text-[9px] font-semibold ${statusClass[finding.status] ?? statusClass.Backlog}`}>{finding.status}</span></td>
                  <td className="truncate px-3 py-2.5">{finding.assignedTo}</td>
                </tr>
              ))}
              {!findings.length && <tr><td colSpan={9} className="py-12 text-center text-xs text-slate-400">No findings match this filter.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
