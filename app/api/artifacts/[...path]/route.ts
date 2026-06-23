import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';
import { resolveArtifactPath } from '@/lib/dashboard/data';

export const dynamic = 'force-dynamic';

const mime: Record<string, string> = {
  pdf: 'application/pdf',
  html: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  zip: 'application/zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  webm: 'video/webm',
  mp4: 'video/mp4',
  txt: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8',
};

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const requested = path.join('/');
  const absolute = resolveArtifactPath(requested);
  if (!absolute || !existsSync(absolute)) return NextResponse.json({ error: 'Artifact not found' }, { status: 404 });
  const info = await stat(absolute);
  if (!info.isFile()) return NextResponse.json({ error: 'Artifact not found' }, { status: 404 });
  const extension = requested.split('.').at(-1)?.toLowerCase() ?? '';
  const headers = new Headers({
    'content-type': mime[extension] ?? 'application/octet-stream',
    'content-length': String(info.size),
    'cache-control': 'private, max-age=60',
  });
  if (request.nextUrl.searchParams.get('download') === '1') {
    headers.set('content-disposition', `attachment; filename="${requested.split('/').at(-1)}"`);
  }
  return new NextResponse(Readable.toWeb(createReadStream(absolute)) as ReadableStream, { headers });
}
