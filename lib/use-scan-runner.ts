'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/ui/toast';

export type ScanPhase = 'queued' | 'running' | 'completed' | 'failed' | 'error';

export interface ScanState {
  type: string;
  id?: string;
  phase: ScanPhase;
  stage: string;
  progress: number;
  error?: string;
  /** True when the run is dispatched but live status polling is unavailable. */
  detached?: boolean;
}

const POLL_INTERVAL_MS = 5000;
const ACTIVE_PHASES: ScanPhase[] = ['queued', 'running'];

export function isScanActive(state?: ScanState): boolean {
  return Boolean(state && ACTIVE_PHASES.includes(state.phase));
}

/**
 * Drives a scan through dispatch (`POST /api/scans`) and live progress polling
 * (`GET /api/scans/status`), surfacing toasts for every lifecycle event.
 * Multiple suites can be tracked concurrently, keyed by scan type.
 */
export function useScanRunner(options?: { onComplete?: (type: string) => void }) {
  const { toast } = useToast();
  const onComplete = options?.onComplete;
  const [scans, setScans] = useState<Record<string, ScanState>>({});
  const timers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const clearTimer = useCallback((type: string) => {
    const timer = timers.current[type];
    if (timer) {
      clearInterval(timer);
      delete timers.current[type];
    }
  }, []);

  useEffect(() => {
    const active = timers.current;
    return () => {
      for (const timer of Object.values(active)) clearInterval(timer);
    };
  }, []);

  const poll = useCallback((type: string, id: string) => {
    const tick = async () => {
      const response = await fetch(`/api/scans/status?id=${encodeURIComponent(id)}`, { cache: 'no-store' }).catch(() => null);
      if (!response?.ok) return;
      const body = await response.json().catch(() => null);
      if (!body) return;

      setScans((prev) => {
        const current = prev[type];
        if (!current) return prev;
        return {
          ...prev,
          [type]: {
            ...current,
            phase: body.phase ?? current.phase,
            stage: body.stage ?? current.stage,
            progress: typeof body.progress === 'number' ? body.progress : current.progress,
          },
        };
      });

      if (body.phase === 'completed') {
        clearTimer(type);
        toast({ id: `scan-${type}`, variant: 'success', title: 'Scan completed', description: `${labelFor(type)} finished. Fresh results are publishing to the dashboard.` });
        onComplete?.(type);
      } else if (body.phase === 'failed') {
        clearTimer(type);
        toast({ id: `scan-${type}`, variant: 'error', title: 'Scan failed', description: `${labelFor(type)} ended with errors. Check the CI run for details.` });
      }
    };

    clearTimer(type);
    timers.current[type] = setInterval(tick, POLL_INTERVAL_MS);
    void tick();
  }, [clearTimer, onComplete, toast]);

  const run = useCallback(async (type: string) => {
    const existing = timers.current[type];
    setScans((prev) => {
      if (isScanActive(prev[type])) return prev; // duplicate-click guard
      return { ...prev, [type]: { type, phase: 'queued', stage: 'Queued', progress: 3 } };
    });
    if (existing) return; // already running for this type

    toast({ id: `scan-${type}`, variant: 'loading', title: 'Scan queued', description: `${labelFor(type)} is being dispatched to the managed worker.` });

    try {
      const response = await fetch('/api/scans', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      const body = await response.json().catch(() => ({} as Record<string, unknown>));

      if (!response.ok) {
        const message = response.status === 401
          ? 'Your session has expired. Please sign in again to run scans.'
          : (typeof body.error === 'string' ? body.error : `Could not start scan (HTTP ${response.status}).`);
        setScans((prev) => ({ ...prev, [type]: { type, phase: 'error', stage: 'Failed', progress: 0, error: message } }));
        toast({ id: `scan-${type}`, variant: 'error', title: 'Scan not started', description: message });
        window.setTimeout(() => setScans((prev) => dropIfPhase(prev, type, 'error')), 8000);
        return;
      }

      const scanId = body.scanId ? String(body.scanId) : '';
      if (scanId) {
        setScans((prev) => ({ ...prev, [type]: { type, id: scanId, phase: 'running', stage: 'Queued', progress: 5 } }));
        toast({ id: `scan-${type}`, variant: 'loading', title: 'Scan started', description: `${labelFor(type)} is running. Tracking live progress…` });
        poll(type, scanId);
      } else {
        // Dispatch succeeded but we couldn't resolve a run id to poll (e.g. status
        // polling token not configured). Surface an honest "queued in CI" state.
        setScans((prev) => ({ ...prev, [type]: { type, phase: 'queued', stage: 'Queued in CI', progress: 5, detached: true } }));
        toast({ id: `scan-${type}`, variant: 'info', title: 'Scan queued in CI', description: 'The dashboard will refresh automatically when new artifacts publish.' });
        window.setTimeout(() => setScans((prev) => dropIfPhase(prev, type, 'queued')), 30000);
      }
    } catch {
      const message = 'Network error. Check your connection and try again.';
      setScans((prev) => ({ ...prev, [type]: { type, phase: 'error', stage: 'Failed', progress: 0, error: message } }));
      toast({ id: `scan-${type}`, variant: 'error', title: 'Scan not started', description: message });
      window.setTimeout(() => setScans((prev) => dropIfPhase(prev, type, 'error')), 8000);
    }
  }, [poll, toast]);

  return { scans, run };
}

function dropIfPhase(scans: Record<string, ScanState>, type: string, phase: ScanPhase): Record<string, ScanState> {
  if (scans[type]?.phase !== phase) return scans;
  const next = { ...scans };
  delete next[type];
  return next;
}

const LABELS: Record<string, string> = {
  full: 'Full Website Scan',
  'pdp-cart': 'PDP & Add-to-Cart',
  revenue: 'Revenue Protection',
  lighthouse: 'Performance Scan',
  seo: 'SEO Scan',
  accessibility: 'Accessibility Scan',
  performance: 'Performance Scan',
  smoke: 'Smoke Suite',
  regression: 'Regression Suite',
};

function labelFor(type: string): string {
  return LABELS[type] ?? 'Scan';
}
