import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getScanStatus, scanConfig } from '@/lib/scan-orchestration';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (process.env.DASHBOARD_AUTH_REQUIRED === 'true' && !session?.user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing scan id.' }, { status: 400 });

  const config = scanConfig();
  if (!config) {
    return NextResponse.json({ phase: 'queued', stage: 'Queued in CI', progress: null, configured: false });
  }

  const status = await getScanStatus(config, id);
  if (!status) {
    return NextResponse.json({ error: 'Scan run not found.' }, { status: 404 });
  }
  return NextResponse.json({ ...status, configured: true }, {
    headers: { 'cache-control': 'no-store' },
  });
}
