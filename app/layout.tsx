import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
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
  const authRequired = process.env.DASHBOARD_AUTH_REQUIRED === 'true';
  // When authentication is enforced and the visitor is not signed in, the only
  // reachable route is the sign-in screen (middleware redirects everything
  // else). Render it bare so no authenticated chrome — top nav, Run Scan,
  // Generate Report, notifications, profile — appears above the login screen.
  const showShell = !authRequired || Boolean(session?.user);
  return (
    <html lang="en">
      <body>
        {showShell ? (
          <DashboardShell user={session?.user ?? null}>{children}</DashboardShell>
        ) : (
          children
        )}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
