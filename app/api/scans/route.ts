import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { dispatchScan, latestRunId, resolveNewRunId, scanConfig } from '@/lib/scan-orchestration';

const allowed = new Set(['full', 'pdp-cart', 'revenue', 'lighthouse', 'seo', 'accessibility', 'performance', 'smoke', 'regression']);

export async function POST(request: NextRequest) {
  const session = await auth();
  if (process.env.DASHBOARD_AUTH_REQUIRED === 'true' && !session?.user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (session?.user && !['admin', 'qa'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Your role does not allow scan execution.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const type = String(body.type ?? 'full');
  if (!allowed.has(type)) return NextResponse.json({ error: 'Unsupported scan profile.' }, { status: 400 });

  const config = scanConfig();
  if (!config) {
    return NextResponse.json({
      error: 'Scan orchestration is not configured. Set GITHUB_WORKFLOW_TOKEN and GITHUB_REPOSITORY.',
    }, { status: 503 });
  }

  // Capture the latest run id before dispatch so we can identify the new run.
  const previousId = await latestRunId(config);
  const dispatched = await dispatchScan(config, type);
  if (!dispatched) {
    return NextResponse.json({ error: 'Managed scan service rejected the request.' }, { status: 502 });
  }

  // Best-effort: resolve the run id the dispatch created so the client can poll
  // live progress. If GitHub hasn't created the run within the window, the
  // client still gets accepted:true and falls back to a "queued in CI" state.
  const scanId = await resolveNewRunId(config, previousId);
  return NextResponse.json({ accepted: true, scanId, type, status: 'queued' }, { status: 202 });
}
