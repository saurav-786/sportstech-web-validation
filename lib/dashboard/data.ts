import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DashboardSnapshot } from './types';

const ROOT = process.cwd();
const SNAPSHOT = resolve(ROOT, 'public', 'dashboard-snapshot.json');
const ARTIFACTS = resolve(ROOT, 'public', 'artifacts');

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  if (!existsSync(SNAPSHOT)) {
    throw new Error('Dashboard snapshot missing. Run npm run dashboard:prepare before starting the app.');
  }
  const snapshot = JSON.parse(await readFile(SNAPSHOT, 'utf8')) as DashboardSnapshot;
  // Backwards-compatibility for snapshots produced before `hasData`/report `suite`
  // were introduced, so the app never crashes on an older prepared artifact.
  if (typeof snapshot.hasData !== 'boolean') {
    snapshot.hasData = Boolean(
      snapshot.execution?.testsTotal
      || snapshot.findings?.length
      || snapshot.reports?.length
      || snapshot.kpis?.some((kpi) => typeof kpi.value === 'number' && kpi.value > 0),
    );
  }
  snapshot.reports = (snapshot.reports ?? []).map((report) => ({ ...report, suite: report.suite ?? 'General' }));
  return snapshot;
}

export function resolveArtifactPath(input: string): string | null {
  const clean = input.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!clean.startsWith('reports/') && !clean.startsWith('test-results/')) return null;
  const prepared = resolve(ARTIFACTS, clean);
  if (!prepared.startsWith(ARTIFACTS) || !existsSync(prepared)) return null;
  return prepared;
}
