'use client';

import { useEffect, useState } from 'react';
import type { DashboardSnapshot } from '@/lib/dashboard/types';
import { DashboardView } from './dashboard-view';

export function LiveDashboard({ initialSnapshot }: { initialSnapshot: DashboardSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const response = await fetch('/api/dashboard', { cache: 'no-store' }).catch(() => null);
      if (response?.ok) setSnapshot(await response.json());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return <DashboardView snapshot={snapshot}/>;
}
