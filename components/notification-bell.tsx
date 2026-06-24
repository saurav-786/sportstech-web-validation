'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Bell, TriangleAlert, Info, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DashboardNotification } from '@/lib/dashboard/types';
import { formatDate } from '@/lib/utils';

const severityIcon = {
  critical: <ShieldAlert size={14} className="mt-0.5 shrink-0 text-red-500" />,
  warning: <TriangleAlert size={14} className="mt-0.5 shrink-0 text-orange-500" />,
  info: <Info size={14} className="mt-0.5 shrink-0 text-indigo-500" />,
};

export function NotificationBell() {
  const [items, setItems] = useState<DashboardNotification[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const response = await fetch('/api/notifications', { cache: 'no-store' }).catch(() => null);
      if (!response?.ok || !active) return;
      const body = await response.json().catch(() => null);
      if (body && Array.isArray(body.items)) setItems(body.items);
    };
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const count = items.length;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="relative rounded-md p-0.5 outline-none transition hover:bg-white/10 focus:ring-2 focus:ring-white/40" aria-label={`Notifications${count ? `, ${count} unread` : ''}`}>
        <Bell size={18} />
        {count > 0 && (
          <span className="absolute -right-1.5 -top-1.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-red-500 px-0.5 text-[8px] font-bold">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={10} className="z-50 w-[300px] rounded-xl border border-slate-200 bg-white p-1.5 text-slate-700 shadow-xl">
          <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Notifications</div>
          {count === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-slate-400">You&apos;re all caught up.</div>
          ) : (
            <div className="max-h-[320px] overflow-y-auto">
              {items.map((item) => (
                <div key={item.id} className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 hover:bg-slate-50">
                  {severityIcon[item.severity]}
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-800">{item.title}</p>
                    {item.detail && <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{item.detail}</p>}
                    <p className="mt-1 text-[10px] text-slate-400">{formatDate(item.time)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
