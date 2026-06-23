'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useEffect, useState } from 'react';
import type { DistributionPoint, TrendPoint } from '@/lib/dashboard/types';

const palette = ['#1749d2', '#1769ff', '#6d36dc', '#14a9c4', '#ff8a00', '#717784', '#ef476f', '#9a76ff'];

const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${date.getDate()} ${date.toLocaleString('en', { month: 'short' })}`;
};

function useChartReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 80);
    return () => window.clearTimeout(timer);
  }, []);
  return ready;
}

function ChartFallback() {
  return <div className="skeleton h-full min-h-[100px] w-full rounded-lg"/>;
}

export function HealthTrend({ data }: { data: TrendPoint[] }) {
  if (!useChartReady()) return <ChartFallback/>;
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={100}>
      <AreaChart data={data} margin={{ top: 12, right: 10, left: -22, bottom: 0 }}>
        <defs>
          <linearGradient id="healthFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1769ff" stopOpacity={0.3}/>
            <stop offset="100%" stopColor="#1769ff" stopOpacity={0.025}/>
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#edf0f6" vertical={false}/>
        <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 9, fill: '#71809b' }} axisLine={false} tickLine={false}/>
        <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: '#71809b' }} axisLine={false} tickLine={false}/>
        <Tooltip labelFormatter={(label) => formatDate(String(label))} contentStyle={{ fontSize: 11, borderRadius: 9, borderColor: '#dfe5ef' }}/>
        <Area type="monotone" dataKey="websiteHealth" name="Website Health" stroke="#1769ff" strokeWidth={2.2} fill="url(#healthFill)" connectNulls/>
        <Line type="monotone" dataKey="revenueHealth" name="Revenue Health" stroke="#6d36dc" strokeWidth={1.8} dot={false} connectNulls/>
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function AddToCartTrend({ data }: { data: TrendPoint[] }) {
  if (!useChartReady()) return <ChartFallback/>;
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={100}>
      <LineChart data={data} margin={{ top: 12, right: 10, left: -22, bottom: 0 }}>
        <CartesianGrid stroke="#edf0f6" vertical={false}/>
        <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 9, fill: '#71809b' }} axisLine={false} tickLine={false}/>
        <YAxis tick={{ fontSize: 9, fill: '#71809b' }} axisLine={false} tickLine={false}/>
        <Tooltip labelFormatter={(label) => formatDate(String(label))} contentStyle={{ fontSize: 11, borderRadius: 9, borderColor: '#dfe5ef' }}/>
        <Line type="monotone" dataKey="failures" name="Failures" stroke="#1769ff" strokeWidth={2.2} dot={{ r: 2.5, fill: '#1769ff' }} connectNulls/>
        <Line type="monotone" dataKey="addToCartSuccess" name="Success %" stroke="#6d36dc" strokeWidth={1.8} dot={{ r: 2.2, fill: '#6d36dc' }} connectNulls/>
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, centerLabel }: { data: DistributionPoint[]; centerLabel?: string }) {
  const ready = useChartReady();
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (!ready) return <ChartFallback/>;
  return (
    <div className="flex h-full min-h-0 items-center gap-2">
      <div className="relative h-full min-h-[160px] flex-1">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={100}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="52%" outerRadius="78%" paddingAngle={1} stroke="#fff" strokeWidth={2}>
              {data.map((item, index) => <Cell key={item.name} fill={palette[index % palette.length]}/>)}
            </Pie>
            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 9, borderColor: '#dfe5ef' }}/>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <span className="text-[10px] text-slate-500">{centerLabel ?? 'Total'}</span>
          <strong className="text-lg leading-none text-slate-800">{total.toLocaleString()}</strong>
        </div>
      </div>
      <div className="w-[42%] space-y-2">
        {data.slice(0, 7).map((item, index) => (
          <div key={item.name} className="flex items-center gap-2 text-[10px]">
            <span className="h-2 w-2 rounded-full" style={{ background: palette[index % palette.length] }}/>
            <span className="min-w-0 flex-1 truncate text-slate-600">{item.name}</span>
            <span className="font-semibold text-slate-800">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RiskBars({ data }: { data: DistributionPoint[] }) {
  if (!useChartReady()) return <ChartFallback/>;
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={100}>
      <BarChart data={data} margin={{ top: 12, right: 10, left: -22, bottom: 0 }}>
        <CartesianGrid stroke="#edf0f6" vertical={false}/>
        <XAxis dataKey="name" tick={{ fontSize: 8, fill: '#71809b' }} axisLine={false} tickLine={false} interval={0}/>
        <YAxis allowDecimals={false} tick={{ fontSize: 9, fill: '#71809b' }} axisLine={false} tickLine={false}/>
        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 9, borderColor: '#dfe5ef' }}/>
        <Bar dataKey="value" name="Risk findings" radius={[3, 3, 0, 0]}>
          {data.map((item, index) => <Cell key={item.name} fill={index === 0 ? '#6d36dc' : '#1769ff'}/>)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RcaBars({ data }: { data: DistributionPoint[] }) {
  if (!useChartReady()) return <ChartFallback/>;
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={100}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 28, left: 12, bottom: 0 }}>
        <CartesianGrid stroke="#edf0f6" horizontal={false}/>
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 9, fill: '#71809b' }} axisLine={false} tickLine={false}/>
        <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 9, fill: '#4b5870' }} axisLine={false} tickLine={false}/>
        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 9, borderColor: '#dfe5ef' }}/>
        <Bar dataKey="value" name="Issue count" fill="#6332df" radius={[0, 4, 4, 0]} barSize={8}/>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Gauge({ label, value, inverse = false }: { label: string; value: number | null; inverse?: boolean }) {
  const ready = useChartReady();
  const number = value ?? 0;
  const color = value === null ? '#cbd3df' : inverse ? (number <= 20 ? '#1769ff' : number <= 40 ? '#ff8a00' : '#ef3340') : (number >= 80 ? '#1769ff' : number >= 60 ? '#7a48eb' : '#ef3340');
  const data = [{ value: number }, { value: 100 - number }];
  if (!ready) return <div className="skeleton h-[92px] rounded-lg"/>;
  return (
    <div className="relative h-[104px] text-center">
      <ResponsiveContainer width="100%" height="92%" minWidth={0} minHeight={80}>
        <PieChart>
          <Pie data={data} dataKey="value" startAngle={180} endAngle={0} cx="50%" cy="82%" innerRadius="64%" outerRadius="82%" stroke="none">
            <Cell fill={color}/><Cell fill="#eef1f6"/>
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-x-0 bottom-1">
        <div className="text-[19px] font-extrabold leading-none text-slate-900">{value === null ? '—' : `${value}%`}</div>
        <div className="mt-1 truncate px-1 text-[9px] font-medium text-slate-500">{label}</div>
      </div>
    </div>
  );
}
