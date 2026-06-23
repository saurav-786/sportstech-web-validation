'use client';

import { ExternalLink, FileArchive, Image as ImageIcon, Search, Video } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { EvidenceItem } from '@/lib/dashboard/types';
import { formatBytes } from '@/lib/utils';
import { PageHeading } from './page-heading';
import { Card } from './ui/card';

export function EvidenceView({ evidence }: { evidence: EvidenceItem[] }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const filtered = useMemo(() => evidence.filter((item) => (kind === 'all' || item.kind === kind) && item.path.toLowerCase().includes(query.toLowerCase())), [evidence, kind, query]);
  return (
    <>
      <PageHeading title="Evidence Center" description="Screenshots, videos, traces, and logs indexed directly from the latest automation artifacts."/>
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[260px] flex-1"><Search className="absolute left-3 top-2.5 text-slate-400" size={14}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by page, device, or step…" className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-xs outline-none focus:border-indigo-400"/></div>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs">{['all', 'screenshot', 'video', 'trace', 'log'].map((value) => <option key={value}>{value}</option>)}</select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {filtered.slice(0, 80).map((item) => (
          <Card key={item.path} className="group overflow-hidden">
            <a href={`/api/artifacts/${item.path}`} target="_blank" className="block">
              <div className="relative grid aspect-video place-items-center overflow-hidden bg-slate-100">
                {item.kind === 'screenshot' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/artifacts/${item.path}`} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"/>
                ) : item.kind === 'video' ? <Video size={32} className="text-indigo-500"/> : item.kind === 'trace' ? <FileArchive size={32} className="text-violet-500"/> : <ImageIcon size={32} className="text-slate-400"/>}
                <span className="absolute right-2 top-2 rounded-md bg-slate-950/70 p-1 text-white opacity-0 transition group-hover:opacity-100"><ExternalLink size={12}/></span>
              </div>
              <div className="p-3"><div className="truncate text-[11px] font-semibold text-slate-700" title={item.path}>{item.name}</div><div className="mt-1 flex justify-between text-[9px] uppercase text-slate-400"><span>{item.kind}</span><span>{formatBytes(item.size)}</span></div></div>
            </a>
          </Card>
        ))}
      </div>
    </>
  );
}
