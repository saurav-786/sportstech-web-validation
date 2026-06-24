'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bot,
  ChartNoAxesCombined,
  FileText,
  Gauge,
  Headphones,
  LayoutDashboard,
  Menu,
  Microscope,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useState, type ReactNode } from 'react';
import { BrandMark } from './brand-mark';
import { HeaderActions } from './header-actions';
import { NotificationBell } from './notification-bell';
import { ProfileMenu } from './profile-menu';
import { ToastProvider } from './ui/toast';
import { ScanRunnerProvider } from '@/lib/use-scan-runner';

const nav = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/website-testing', label: 'Website Testing', icon: Microscope },
  { href: '/ai-rca', label: 'AI RCA', icon: Bot },
  { href: '/reports', label: 'Reports', icon: FileText },
  { href: '/revenue-analytics', label: 'Revenue Analytics', icon: ChartNoAxesCombined },
  { href: '/support-intelligence', label: 'Support Intelligence', icon: Headphones },
  { href: '/lighthouse', label: 'Lighthouse', icon: Gauge },
  { href: '/evidence', label: 'Evidence Center', icon: ShieldCheck },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function DashboardShell({
  children,
  user,
}: {
  children: ReactNode;
  user: { name?: string | null; email?: string | null; image?: string | null; role?: string } | null;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <ToastProvider>
    <ScanRunnerProvider>
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 h-[62px] border-b border-indigo-950/40 bg-gradient-to-r from-[#081748] via-[#11185a] to-[#111044] text-white shadow-[0_5px_18px_rgba(10,20,70,.16)]">
        <div className="mx-auto flex h-full max-w-[1920px] items-center gap-4 px-4 lg:px-5">
          <button className="lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu size={21}/></button>
          <div className="shrink-0 border-r border-white/20 pr-4"><BrandMark /></div>
          <div className="hidden shrink-0 text-[17px] font-medium tracking-[-.025em] xl:block">
            Sportstech AI Quality Intelligence Dashboard
          </div>
          <nav className="ml-auto hidden h-full items-stretch lg:flex">
            {nav.slice(0, 6).map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative flex items-center px-3 text-[11px] font-medium transition hover:bg-white/5 ${active ? 'text-white' : 'text-indigo-100/85'}`}
                >
                  {item.label}
                  {active && <span className="absolute inset-x-1 bottom-0 h-1 rounded-t-full bg-[#6383ff]" />}
                </Link>
              );
            })}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger className="relative flex items-center px-3 text-[11px] font-medium text-indigo-100/85 transition hover:bg-white/5">
                More
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" sideOffset={8} className="z-50 min-w-48 rounded-xl border border-slate-200 bg-white p-1.5 text-slate-700 shadow-xl">
                  {nav.slice(6).map((item) => {
                    const Icon = item.icon;
                    return <DropdownMenu.Item key={item.href} asChild><Link href={item.href} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium outline-none hover:bg-indigo-50 hover:text-indigo-700"><Icon size={15}/>{item.label}</Link></DropdownMenu.Item>;
                  })}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </nav>
          <HeaderActions />
          <div className="flex items-center gap-2.5 border-l border-white/15 pl-3">
            <NotificationBell />
            <ProfileMenu user={user} />
          </div>
        </div>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-slate-950/45" onClick={() => setMenuOpen(false)} aria-label="Close navigation" />
          <aside className="relative h-full w-[300px] bg-[#0d174d] p-5 text-white shadow-2xl">
            <div className="mb-7 flex items-center justify-between"><BrandMark/><button onClick={() => setMenuOpen(false)}><X/></button></div>
            <nav className="space-y-1">
              {nav.map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${pathname === item.href ? 'bg-white/12 text-white' : 'text-indigo-100/80'}`}>
                    <Icon size={17}/>{item.label}
                  </Link>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      <main className="mx-auto max-w-[1920px] p-3.5 lg:p-5">{children}</main>
    </div>
    </ScanRunnerProvider>
    </ToastProvider>
  );
}
