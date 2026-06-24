'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Download, FileText, LoaderCircle, Play, X } from 'lucide-react';
import { useState } from 'react';
import { useScanRunner, isScanActive } from '@/lib/use-scan-runner';
import { useToast } from './ui/toast';
import { Button } from './ui/button';

const scans: Array<[string, string, string]> = [
  ['full', 'Full Website Scan', 'Crawl, validate, aggregate, and publish the full quality snapshot.'],
  ['pdp-cart', 'PDP & Add-to-Cart', 'Run the product-page device matrix and cart journey.'],
  ['seo', 'SEO Scan', 'Metadata, canonicals, structured data and indexing.'],
  ['accessibility', 'Accessibility Scan', 'WCAG and keyboard checks with axe-core.'],
  ['lighthouse', 'Performance Scan', 'Measure desktop and mobile performance and quality scores.'],
  ['smoke', 'Smoke Suite', 'Fast critical-page validation.'],
  ['regression', 'Regression Suite', 'Cross-area enterprise regression checks.'],
  ['revenue', 'Revenue Protection', 'Exercise the purchase funnel up to the safe payment boundary.'],
];

export function HeaderActions() {
  const [open, setOpen] = useState(false);
  const { scans: active, run } = useScanRunner();
  const { toast } = useToast();
  const anyActive = Object.values(active).some(isScanActive);

  async function openLatestReport(download: boolean) {
    const response = await fetch('/api/reports/latest', { cache: 'no-store' }).catch(() => null);
    const body = response?.ok ? await response.json().catch(() => null) : null;
    const target = body?.pdf ?? body?.html ?? body?.json ?? body?.csv ?? null;
    if (!target) {
      toast({ variant: 'error', title: 'No report available', description: 'Please run a scan first to generate a report.' });
      return;
    }
    const href = `/api/artifacts/${target.path}${download ? '?download=1' : ''}`;
    if (download) {
      window.location.href = href;
      toast({ variant: 'success', title: 'Downloading report', description: target.name });
    } else {
      window.open(href, '_blank', 'noopener');
      toast({ variant: 'success', title: 'Opening latest report', description: target.name });
    }
  }

  return (
    <div className="ml-0 flex shrink-0 items-center gap-2 lg:ml-1">
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <Button variant="primary" size="sm" className="border-white/10 px-3">
            {anyActive ? <LoaderCircle size={13} className="animate-spin" /> : <Play size={13} fill="currentColor" />}
            {anyActive ? 'Running…' : 'Run Scan'}
          </Button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(94vw,620px)] max-h-[88vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <Dialog.Title className="text-lg font-bold text-slate-900">Run website intelligence scan</Dialog.Title>
                <Dialog.Description className="mt-1 text-xs text-slate-500">Choose an automation profile. Execution runs safely in the managed worker and progress is tracked live.</Dialog.Description>
              </div>
              <Dialog.Close className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100"><X size={18}/></Dialog.Close>
            </div>
            <div className="mt-5 grid gap-2">
              {scans.map(([type, label, description]) => {
                const state = active[type];
                const running = isScanActive(state);
                return (
                  <button
                    key={type}
                    onClick={() => run(type)}
                    disabled={running}
                    className="rounded-xl border border-slate-200 p-3.5 text-left transition hover:border-indigo-300 hover:bg-indigo-50/50 disabled:cursor-not-allowed disabled:opacity-80"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span>
                        <span className="block text-sm font-bold text-slate-800">{label}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">{description}</span>
                      </span>
                      {running
                        ? <LoaderCircle className="shrink-0 animate-spin text-indigo-600" size={18}/>
                        : <Play className="shrink-0 text-indigo-600" size={17}/>}
                    </div>
                    {state && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-[10px] font-semibold">
                          <span className={state.phase === 'failed' || state.phase === 'error' ? 'text-red-600' : state.phase === 'completed' ? 'text-emerald-600' : 'text-indigo-600'}>
                            {state.phase === 'error' ? (state.error ?? 'Failed') : state.stage}
                          </span>
                          <span className="text-slate-400">{Math.round(state.progress)}%</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${state.phase === 'failed' || state.phase === 'error' ? 'bg-red-500' : state.phase === 'completed' ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                            style={{ width: `${Math.max(3, Math.min(100, state.progress))}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Button onClick={() => openLatestReport(false)} size="sm" className="hidden border-white/25 bg-white/5 text-white hover:bg-white/10 md:inline-flex"><FileText size={13}/>Generate Report</Button>
      <Button onClick={() => openLatestReport(true)} size="sm" className="hidden border-white/25 bg-white/5 text-white hover:bg-white/10 xl:inline-flex"><Download size={13}/>Download PDF</Button>
    </div>
  );
}
