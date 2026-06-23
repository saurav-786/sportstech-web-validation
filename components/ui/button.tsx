import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
};

export function Button({ className, variant = 'outline', size = 'md', ...props }: Props) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg border font-semibold transition focus:outline-none focus:ring-2 focus:ring-violet-400/40 disabled:cursor-not-allowed disabled:opacity-55',
        size === 'sm' ? 'h-8 px-3 text-[11px]' : 'h-9 px-3.5 text-xs',
        variant === 'primary' && 'border-violet-500 bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-[0_6px_16px_rgba(92,59,225,.26)] hover:brightness-105',
        variant === 'outline' && 'border-slate-300 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/60',
        variant === 'ghost' && 'border-transparent bg-transparent text-slate-600 hover:bg-slate-100',
        variant === 'danger' && 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
        className,
      )}
      {...props}
    />
  );
}
