import {
  Activity,
  CircleAlert,
  Gauge,
  HeartPulse,
  PackageSearch,
  ScanSearch,
  ShieldAlert,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { KpiMetric } from '@/lib/dashboard/types';
import { Card } from './ui/card';

const iconMap = {
  pages: ScanSearch,
  pdp: PackageSearch,
  cart: ShoppingCart,
  'failed-pdp': CircleAlert,
  critical: ShieldAlert,
  health: HeartPulse,
  lighthouse: Gauge,
  revenue: Activity,
};

const tone = {
  positive: { icon: 'text-emerald-600', bg: 'bg-emerald-50', detail: 'text-emerald-600' },
  negative: { icon: 'text-red-600', bg: 'bg-red-50', detail: 'text-red-600' },
  warning: { icon: 'text-orange-600', bg: 'bg-orange-50', detail: 'text-orange-600' },
  neutral: { icon: 'text-indigo-600', bg: 'bg-indigo-50', detail: 'text-slate-500' },
};

export function KpiCard({ metric }: { metric: KpiMetric }) {
  const Icon = iconMap[metric.key as keyof typeof iconMap] ?? Activity;
  const colors = tone[metric.tone];
  const positive = metric.tone === 'positive' || metric.tone === 'neutral';
  return (
    <Card className="min-w-0 p-3.5">
      <div className="flex items-start gap-3">
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${colors.bg} ${colors.icon}`}><Icon size={20} strokeWidth={2}/></div>
        <div className="min-w-0">
          <div className="truncate text-[10px] font-semibold text-slate-500">{metric.label}</div>
          <div className="mt-0.5 text-[22px] font-extrabold leading-none tracking-[-.035em] text-slate-900">{metric.display}</div>
        </div>
      </div>
      <div className={`mt-3 flex min-w-0 items-center gap-1.5 truncate text-[9px] font-semibold ${colors.detail}`}>
        {positive ? <TrendingUp size={11}/> : <TrendingDown size={11}/>}
        <span className="truncate">{metric.detail}</span>
      </div>
    </Card>
  );
}
