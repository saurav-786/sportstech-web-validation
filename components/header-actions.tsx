'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Download, FileText, LoaderCircle, Play, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from './ui/button';

const scans = [
  ['full', 'Full Website Scan', 'Crawl, validate, aggregate, and publish the full quality snapshot.'],
  ['pdp-cart', 'PDP & Add-to-Cart', 'Run the product-page device matrix and cart journey.'],
  ['revenue', 'Revenue Protection', 'Exercise the purchase funnel up to the safe payment boundary.'],
  ['lighthouse', 'Lighthouse Audit', 'Measure desktop and mobile performance and quality scores.'],
];

export function HeaderActions() {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  async function runScan(type: string) {
    setRunning(type);
    setMessage('');
    try {
      const response = await fetch('/api/scans', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Unable to start scan');
      setMessage('Scan accepted. The dashboard will refresh when the new artifacts are published.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to start scan');
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="ml-0 flex shrink-0 items-center gap-2 lg:ml-1">
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <Button variant="primary" size="sm" className="border-white/10 px-3"><Play size={13} fill="currentColor"/>Run Scan</Button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(94vw,620px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <Dialog.Title className="text-lg font-bold text-slate-900">Run website intelligence scan</Dialog.Title>
                <Dialog.Description className="mt-1 text-xs text-slate-500">Choose an existing automation profile. Execution runs safely in the managed worker.</Dialog.Description>
              </div>
              <Dialog.Close className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100"><X size={18}/></Dialog.Close>
            </div>
            <div className="mt-5 grid gap-2">
              {scans.map(([type, label, description]) => (
                <button key={type} onClick={() => runScan(type)} disabled={Boolean(running)} className="flex items-center justify-between rounded-xl border border-slate-200 p-3.5 text-left transition hover:border-indigo-300 hover:bg-indigo-50/50 disabled:opacity-60">
                  <span><span className="block text-sm font-bold text-slate-800">{label}</span><span className="mt-0.5 block text-xs text-slate-500">{description}</span></span>
                  {running === type ? <LoaderCircle className="animate-spin text-indigo-600" size={18}/> : <Play className="text-indigo-600" size={17}/>}
                </button>
              ))}
            </div>
            {message && <p className={`mt-4 rounded-lg px-3 py-2 text-xs ${message.startsWith('Scan accepted') ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{message}</p>}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <a href="/api/artifacts/reports/executive-summary.pdf" className="hidden md:block">
        <Button size="sm" className="border-white/25 bg-white/5 text-white hover:bg-white/10"><FileText size={13}/>Generate Report</Button>
      </a>
      <a href="/api/artifacts/reports/executive-summary.pdf?download=1" className="hidden xl:block">
        <Button size="sm" className="border-white/25 bg-white/5 text-white hover:bg-white/10"><Download size={13}/>Download PDF</Button>
      </a>
    </div>
  );
}
