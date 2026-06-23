import type { ReactNode } from 'react';

export function PageHeading({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <h1 className="text-xl font-extrabold tracking-[-.035em] text-slate-900">{title}</h1>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">{description}</p>
      </div>
      {actions && <div className="ml-auto flex gap-2">{actions}</div>}
    </div>
  );
}
