import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

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

  const token = process.env.GITHUB_WORKFLOW_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const ref = process.env.GITHUB_WORKFLOW_REF ?? 'main';
  if (!token || !repository) {
    return NextResponse.json({
      error: 'Scan orchestration is not configured. Set GITHUB_WORKFLOW_TOKEN and GITHUB_REPOSITORY.',
    }, { status: 503 });
  }

  const response = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/dashboard-scan.yml/dispatches`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ref, inputs: { scan_type: type } }),
  });
  if (!response.ok) {
    return NextResponse.json({ error: `Managed scan service returned ${response.status}.` }, { status: 502 });
  }
  return NextResponse.json({ accepted: true, type, status: 'queued' }, { status: 202 });
}
