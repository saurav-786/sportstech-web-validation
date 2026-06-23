'use client';

import { Accessibility, Activity, Braces, Gauge, LoaderCircle, Play, SearchCode, ShieldCheck, ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import type { DashboardSnapshot } from '@/lib/dashboard/types';
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
  const [running, setRunning] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  async function start(id: string) {
    setRunning(id);
    const response = await fetch('/api/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: id }) });
    const body = await response.json();
    setMessage(response.ok ? `${suites.find((suite) => suite.id === id)?.label} queued successfully.` : body.error);
    setRunning(null);
  }

  return (
    <>
      <PageHeading title="Website Testing" description="Launch the existing Playwright and Lighthouse automation without a terminal. Long-running jobs execute in the managed CI worker and publish fresh artifacts back to this dashboard."/>
      {message && <div className="mb-4 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">{message}</div>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {suites.map(({ id, label, icon: Icon, detail }) => (
          <Card key={id} className="p-4">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Icon size={20}/></div>
              <div className="min-w-0"><h2 className="text-sm font-bold text-slate-800">{label}</h2><p className="mt-1 min-h-10 text-[11px] leading-4 text-slate-500">{detail}</p></div>
            </div>
            <Button variant="primary" className="mt-4 w-full" onClick={() => start(id)} disabled={Boolean(running)}>
              {running === id ? <LoaderCircle className="animate-spin" size={14}/> : <Play size={14}/>} Run suite
            </Button>
          </Card>
        ))}
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
