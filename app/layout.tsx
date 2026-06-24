import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { auth } from '@/auth';
import { DashboardShell } from '@/components/dashboard-shell';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sportstech AI Quality Intelligence Dashboard',
  description: 'Executive website quality, revenue protection, and automation intelligence for Sportstech.',
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  return (
    <html lang="en">
      <body>
        <DashboardShell user={session?.user ?? null}>{children}</DashboardShell>
        <Analytics />
      </body>
    </html>
  );
}
