'use client';

import { CheckCircle2, Info, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastVariant = 'success' | 'error' | 'info' | 'loading';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Auto-dismiss delay in ms. Pass 0 to keep until dismissed. Defaults to 4500. */
  duration?: number;
  /** Stable id — reusing an id updates the existing toast in place. */
  id?: string;
}

interface ToastRecord extends Required<Pick<ToastOptions, 'title' | 'variant'>> {
  id: string;
  description?: string;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const variantStyles: Record<ToastVariant, { ring: string; icon: ReactNode }> = {
  success: { ring: 'border-emerald-200', icon: <CheckCircle2 size={16} className="text-emerald-600" /> },
  error: { ring: 'border-red-200', icon: <TriangleAlert size={16} className="text-red-600" /> },
  info: { ring: 'border-indigo-200', icon: <Info size={16} className="text-indigo-600" /> },
  loading: { ring: 'border-indigo-200', icon: <LoaderCircle size={16} className="animate-spin text-indigo-600" /> },
};

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
    const timer = timers.current[id];
    if (timer) {
      clearTimeout(timer);
      delete timers.current[id];
    }
  }, []);

  const toast = useCallback((options: ToastOptions) => {
    counter += 1;
    const id = options.id ?? `toast-${counter}`;
    const record: ToastRecord = {
      id,
      title: options.title,
      description: options.description,
      variant: options.variant ?? 'info',
    };
    setToasts((prev) => {
      const exists = prev.some((item) => item.id === id);
      return exists ? prev.map((item) => (item.id === id ? record : item)) : [...prev, record];
    });
    if (timers.current[id]) clearTimeout(timers.current[id]);
    const duration = options.duration ?? 4500;
    if (duration > 0) {
      timers.current[id] = setTimeout(() => dismiss(id), duration);
    }
    return id;
  }, [dismiss]);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,360px)] flex-col gap-2">
        {toasts.map((item) => {
          const styles = variantStyles[item.variant];
          return (
            <div
              key={item.id}
              className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border ${styles.ring} bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,.16)]`}
              role="status"
            >
              <span className="mt-0.5 shrink-0">{styles.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-800">{item.title}</p>
                {item.description && <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{item.description}</p>}
              </div>
              <button onClick={() => dismiss(item.id)} className="shrink-0 rounded-md p-0.5 text-slate-400 hover:bg-slate-100" aria-label="Dismiss">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    // Safe no-op fallback so components never crash if rendered outside a provider.
    return { toast: () => '', dismiss: () => {} };
  }
  return context;
}
