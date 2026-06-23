import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { appConfig } from '../config.js';

export function revenueRunId(): string {
  return process.env.REVENUE_RUN_ID ?? 'latest';
}

export function revenueRunDir(runId = revenueRunId()): string {
  return join(appConfig.reportsDir, 'revenue-runs', runId);
}

export async function resolveRevenueRunDir(): Promise<string> {
  if (process.env.REVENUE_RUN_ID) return revenueRunDir();
  const root = join(appConfig.reportsDir, 'revenue-runs');
  if (!existsSync(root)) return appConfig.reportsDir;
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  return entries.length ? revenueRunDir(entries[0]) : appConfig.reportsDir;
}
