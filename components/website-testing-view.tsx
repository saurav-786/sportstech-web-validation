'use client';

import { Accessibility, Activity, Braces, Gauge, LoaderCircle, Play, SearchCode, ShieldCheck, ShoppingCart } from 'lucide-react';
import type { DashboardSnapshot } from '@/lib/dashboard/types';
import { isScanActive, useScanRunner } from '@/lib/use-scan-runner';
import { PageHeading } from './page-heading';
import { Button } from './ui/button';
import { Card } from './ui/card';

const suites = [
  { id: 'full', label: 'Full Website Scan', icon: SearchCode, detail: 'Crawl and validate the full configured surface.' },
  { id: 'pdp-cart', label: 'PDP & Add-to-Cart', icon: ShoppingCart, detail: 'Product pages across the configured device matrix.' },
  { id: 'seo', label: 'SEO Scan', icon: Activity, detail: 'Metadata, canonicals, structured data and indexing.' },
  { id: 'accessibility', label: 'Accessibility Scan', icon: Accessibility, detail: 'WCAG and keyboard checks with axe-core.' },
  { id: 'lighthouse', label: 'Performance Scan', icon: Gauge, detail: 'Desktop and mobile Lighthouse audits.' },
  { id: 'smoke', label: 'Smoke Suite', icon: ShieldCheck, detail: 'Fast critical-page validation.' },
  { id: 'regression', label: 'Regression Suite', icon: Braces, detail: 'Cross-area enterprise regression checks.' },
];

export function WebsiteTestingView({ snapshot }: { snapshot: DashboardSnapshot }) {
  const { scans, run } = useScanRunner();

  return (
    <>
      <PageHeading title="Website Testing" description="Launch the existing Playwright and Lighthouse automation without a terminal. Long-running jobs execute in the managed CI worker and publish fresh artifacts back to this dashboard."/>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {suites.map(({ id, label, icon: Icon, detail }) => {
          const state = scans[id];
          const running = isScanActive(state);
          const failed = state?.phase === 'failed' || state?.phase === 'error';
          const done = state?.phase === 'completed';
          return (
            <Card key={id} className="p-4">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Icon size={20}/></div>
                <div className="min-w-0"><h2 className="text-sm font-bold text-slate-800">{label}</h2><p className="mt-1 min-h-10 text-[11px] leading-4 text-slate-500">{detail}</p></div>
              </div>
              <Button variant="primary" className="mt-4 w-full" onClick={() => run(id)} disabled={running}>
                {running ? <LoaderCircle className="animate-spin" size={14}/> : <Play size={14}/>} {running ? 'Running…' : 'Run suite'}
              </Button>
              {state && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-[10px] font-semibold">
                    <span className={failed ? 'text-red-600' : done ? 'text-emerald-600' : 'text-indigo-600'}>
                      {state.phase === 'error' ? (state.error ?? 'Failed') : state.stage}
                    </span>
                    <span className="text-slate-400">{Math.round(state.progress)}%</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${failed ? 'bg-red-500' : done ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                      style={{ width: `${Math.max(3, Math.min(100, state.progress))}%` }}
                    />
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
      <Card className="mt-4 overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3"><h2 className="panel-title">Latest PDP Device Matrix</h2><p className="mt-0.5 text-[10px] text-slate-500">Real results from the latest fast PDP/cart summary.</p></div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] text-slate-500"><tr><th className="px-4 py-2.5">Device</th><th className="px-4 py-2.5">Tested</th><th className="px-4 py-2.5">Passed</th><th className="px-4 py-2.5">Failed</th><th className="px-4 py-2.5">Pass Rate</th></tr></thead>
            <tbody>{snapshot.deviceResults.map((row) => <tr key={row.device} className="border-t border-slate-100"><td className="px-4 py-3 font-semibold text-slate-700">{row.device}</td><td className="px-4 py-3">{row.tested}</td><td className="px-4 py-3 text-emerald-700">{row.passed}</td><td className="px-4 py-3 text-red-700">{row.failed}</td><td className="px-4 py-3"><span className="font-bold">{row.passRate}%</span></td></tr>)}</tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
