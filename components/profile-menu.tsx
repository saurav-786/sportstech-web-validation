'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { LogIn, LogOut, UserRound } from 'lucide-react';
import Link from 'next/link';
import { signOut } from 'next-auth/react';

type SessionUser = { name?: string | null; email?: string | null; image?: string | null; role?: string } | null;

function initials(user: SessionUser): string {
  const source = user?.name ?? user?.email ?? 'ST';
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function ProfileMenu({ user }: { user: SessionUser }) {
  const signedIn = Boolean(user);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="rounded-full outline-none transition focus:ring-2 focus:ring-white/50" aria-label="Account menu">
        {user?.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" className="h-8 w-8 rounded-full border-2 border-white/80 object-cover" />
        ) : (
          <div className="grid h-8 w-8 place-items-center rounded-full bg-white text-[11px] font-extrabold text-indigo-800">
            {initials(user)}
          </div>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={10} className="z-50 min-w-[240px] rounded-xl border border-slate-200 bg-white p-1.5 text-slate-700 shadow-xl">
          <div className="px-3 py-2.5">
            <p className="truncate text-sm font-bold text-slate-800">{user?.name ?? (signedIn ? 'Signed in' : 'Not signed in')}</p>
            {user?.email && <p className="mt-0.5 truncate text-[11px] text-slate-500">{user.email}</p>}
            {user?.role && <span className="mt-1.5 inline-flex rounded bg-indigo-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-700">{user.role}</span>}
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-slate-100" />
          <DropdownMenu.Item asChild>
            <Link href="/settings" className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium outline-none hover:bg-indigo-50 hover:text-indigo-700">
              <UserRound size={15} /> Profile / Account
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-slate-100" />
          {signedIn ? (
            <DropdownMenu.Item
              onSelect={() => { void signOut({ callbackUrl: '/signin' }); }}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-red-600 outline-none hover:bg-red-50"
            >
              <LogOut size={15} /> Logout
            </DropdownMenu.Item>
          ) : (
            <DropdownMenu.Item asChild>
              <Link href="/signin" className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-indigo-700 outline-none hover:bg-indigo-50">
                <LogIn size={15} /> Sign in
              </Link>
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
