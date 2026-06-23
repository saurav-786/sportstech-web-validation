import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card } from './ui/card';

export function Panel({ title, subtitle, action, className = '', children }: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={`min-h-0 overflow-hidden ${className}`}>
      <div className="flex min-h-11 items-start justify-between gap-3 px-4 pt-3.5">
        <div>
          <div className="flex items-center gap-1.5"><h2 className="panel-title">{title}</h2><Info size={11} className="text-slate-400"/></div>
          {subtitle && <p className="mt-0.5 text-[9px] text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}
