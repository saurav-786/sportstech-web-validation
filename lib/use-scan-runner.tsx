'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useToast } from '@/components/ui/toast';

export type ScanPhase = 'queued' | 'running' | 'completed' | 'failed' | 'error';

export interface ScanState {
  type: string;
  id?: string;
  phase: ScanPhase;
  stage: string;
  /** Value shown in the UI (may be interpolated above the server value). */
  progress: number;
  /** Last progress reported by the server; the floor for interpolation. */
  base: number;
  /** Timestamp (ms) when `base` last advanced — anchors interpolation. */
  baseAt: number;
  /** Timestamp (ms) when the run was first dispatched. */
  startedAt: number;
  error?: string;
  /** True when the run is dispatched but live status polling is unavailable. */
  detached?: boolean;
}

const POLL_INTERVAL_MS = 5000;
const INTERP_INTERVAL_MS = 1000;
const INTERP_CEILING = 92; // never let interpolation reach "done"
const INTERP_TAU_MS = 120_000; // ~2 min characteristic creep time
const STORAGE_KEY = 'sportstech.activeScans';
const MAX_RESTORE_AGE_MS = 2 * 60 * 60 * 1000; // drop persisted scans older than 2h
const ACTIVE_PHASES: ScanPhase[] = ['queued', 'running'];

export function isScanActive(state?: ScanState): boolean {
  return Boolean(state && ACTIVE_PHASES.includes(state.phase));
}

/**
 * Smoothly creeps the displayed progress from `base` toward a ceiling while a
 * single long-running CI step (e.g. the SEO suite) is executing. The server
 * only reports step-granular progress, so without this the bar freezes for
 * minutes. Interpolation never drops below the server value or exceeds the
 * ceiling, so a real step completion still produces a visible jump.
 */
function interpolate(base: number, baseAt: number, now: number): number {
  if (base >= INTERP_CEILING) return base;
  const elapsed = Math.max(0, now - baseAt);
  const gap = INTERP_CEILING - base;
  const eased = gap * (1 - Math.exp(-elapsed / INTERP_TAU_MS));
  return Math.min(INTERP_CEILING, base + eased);
}

interface ScanRunnerValue {
  scans: Record<string, ScanState>;
  run: (type: string) => Promise<void>;
}

const ScanRunnerContext = createContext<ScanRunnerValue | null>(null);

/**
 * Single source of truth for scan progress. Mounted once high in the tree
 * (inside DashboardShell) so polling survives route changes — navigating away
 * from the page that started a scan no longer kills its progress tracking.
 * Active scans are mirrored to localStorage and resumed on reload.
 */
export function ScanRunnerProvider({
  children,
  onComplete,
}: {
  children: ReactNode;
  onComplete?: (type: string) => void;
}) {
  const { toast } = useToast();
  const [scans, setScans] = useState<Record<string, ScanState>>({});
  const timers = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const interpTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const scansRef = useRef(scans);
  scansRef.current = scans;

  const clearTimer = useCallback((type: string) => {
    const timer = timers.current[type];
    if (timer) {
      clearInterval(timer);
      delete timers.current[type];
    }
  }, []);

  // Persist active scans so a reload can resume tracking.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const active = Object.values(scans).filter(isScanActive);
    try {
      if (active.length === 0) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(active));
    } catch {
      /* storage unavailable — tracking still works for this session */
    }
  }, [scans]);

  const poll = useCallback((type: string, id: string) => {
    const tick = async () => {
      const response = await fetch(`/api/scans/status?id=${encodeURIComponent(id)}`, { cache: 'no-store' }).catch(() => null);
      if (!response?.ok) return;
      const body = await response.json().catch(() => null);
      if (!body) return;

      setScans((prev) => {
        const current = prev[type];
        if (!current) return prev;
        const serverProgress = typeof body.progress === 'number' ? body.progress : current.base;
        const advanced = serverProgress > current.base;
        const base = advanced ? serverProgress : current.base;
        const baseAt = advanced ? Date.now() : current.baseAt;
        return {
          ...prev,
          [type]: {
            ...current,
            phase: body.phase ?? current.phase,
            stage: body.stage ?? current.stage,
            base,
            baseAt,
            progress: Math.max(current.progress, base),
          },
        };
      });

      if (body.phase === 'completed') {
        clearTimer(type);
        setScans((prev) => (prev[type] ? { ...prev, [type]: { ...prev[type], phase: 'completed', progress: 100, base: 100 } } : prev));
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

  // Drive the interpolation tick whenever a scan is running.
  useEffect(() => {
    const anyRunning = Object.values(scans).some((s) => s.phase === 'running');
    if (anyRunning && !interpTimer.current) {
      interpTimer.current = setInterval(() => {
        const now = Date.now();
        setScans((prev) => {
          let changed = false;
          const next: Record<string, ScanState> = {};
          for (const [type, s] of Object.entries(prev)) {
            if (s.phase === 'running') {
              const display = interpolate(s.base, s.baseAt, now);
              if (display > s.progress + 0.05) {
                next[type] = { ...s, progress: display };
                changed = true;
                continue;
              }
            }
            next[type] = s;
          }
          return changed ? next : prev;
        });
      }, INTERP_INTERVAL_MS);
    } else if (!anyRunning && interpTimer.current) {
      clearInterval(interpTimer.current);
      interpTimer.current = null;
    }
  }, [scans]);

  // Resume any scans that were active before a reload.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let restored: ScanState[] = [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) restored = JSON.parse(raw) as ScanState[];
    } catch {
      restored = [];
    }
    const now = Date.now();
    const fresh = restored.filter((s) => s.id && now - (s.startedAt ?? 0) < MAX_RESTORE_AGE_MS);
    if (fresh.length === 0) return;
    setScans((prev) => {
      const next = { ...prev };
      for (const s of fresh) if (!next[s.type]) next[s.type] = s;
      return next;
    });
    for (const s of fresh) if (s.id) poll(s.type, s.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tear down every timer when the provider unmounts (app close / sign-out).
  useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      for (const timer of Object.values(activeTimers)) clearInterval(timer);
      if (interpTimer.current) clearInterval(interpTimer.current);
    };
  }, []);

  const run = useCallback(async (type: string) => {
    if (isScanActive(scansRef.current[type])) return; // duplicate-click guard
    const now = Date.now();
    setScans((prev) => ({ ...prev, [type]: { type, phase: 'queued', stage: 'Queued', progress: 3, base: 3, baseAt: now, startedAt: now } }));

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
        setScans((prev) => ({ ...prev, [type]: { type, phase: 'error', stage: 'Failed', progress: 0, base: 0, baseAt: Date.now(), startedAt: now, error: message } }));
        toast({ id: `scan-${type}`, variant: 'error', title: 'Scan not started', description: message });
        window.setTimeout(() => setScans((prev) => dropIfPhase(prev, type, 'error')), 8000);
        return;
      }

      const scanId = body.scanId ? String(body.scanId) : '';
      if (scanId) {
        const t = Date.now();
        setScans((prev) => ({ ...prev, [type]: { type, id: scanId, phase: 'running', stage: 'Queued', progress: 5, base: 5, baseAt: t, startedAt: now } }));
        toast({ id: `scan-${type}`, variant: 'loading', title: 'Scan started', description: `${labelFor(type)} is running. Tracking live progress…` });
        poll(type, scanId);
      } else {
        // Dispatch succeeded but we couldn't resolve a run id to poll (e.g. status
        // polling token not configured). Surface an honest "queued in CI" state.
        setScans((prev) => ({ ...prev, [type]: { type, phase: 'queued', stage: 'Queued in CI', progress: 5, base: 5, baseAt: Date.now(), startedAt: now, detached: true } }));
        toast({ id: `scan-${type}`, variant: 'info', title: 'Scan queued in CI', description: 'The dashboard will refresh automatically when new artifacts publish.' });
        window.setTimeout(() => setScans((prev) => dropIfPhase(prev, type, 'queued')), 30000);
      }
    } catch {
      const message = 'Network error. Check your connection and try again.';
      setScans((prev) => ({ ...prev, [type]: { type, phase: 'error', stage: 'Failed', progress: 0, base: 0, baseAt: Date.now(), startedAt: now, error: message } }));
      toast({ id: `scan-${type}`, variant: 'error', title: 'Scan not started', description: message });
      window.setTimeout(() => setScans((prev) => dropIfPhase(prev, type, 'error')), 8000);
    }
  }, [poll, toast]);

  const value = useMemo<ScanRunnerValue>(() => ({ scans, run }), [scans, run]);
  return <ScanRunnerContext.Provider value={value}>{children}</ScanRunnerContext.Provider>;
}

/**
 * Reads the shared scan state. Falls back to an inert local value if used
 * outside a provider so isolated component tests don't crash.
 */
export function useScanRunner(): ScanRunnerValue {
  const ctx = useContext(ScanRunnerContext);
  if (ctx) return ctx;
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.warn('useScanRunner used outside <ScanRunnerProvider>; scans will not be tracked.');
  }
  return INERT;
}

const INERT: ScanRunnerValue = { scans: {}, run: async () => {} };

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
