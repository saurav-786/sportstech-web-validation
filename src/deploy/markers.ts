/**
 * markers.ts — Phase 10: deployment event source.
 * Reads deployment events from test-data/deployments.json (recommended start),
 * falling back to the latest git commit as a single implicit deployment.
 * JSON schema: [{ "id","timestamp","ref","author","description","environment" }]
 */
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { appConfig } from '../config.js';
import type { DeploymentEvent } from '../types.js';
import { readJson } from '../utils/fs.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('deploy');

export async function loadDeployments(path = appConfig.revenue.deploymentsPath): Promise<DeploymentEvent[]> {
  if (existsSync(path)) {
    try {
      const events = await readJson<DeploymentEvent[]>(path);
      if (Array.isArray(events) && events.length) {
        return [...events].sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
      }
    } catch (err) {
      log.warn(`Could not parse ${path}: ${err instanceof Error ? err.message : err}`);
    }
  }
  // Git fallback: most recent commit as one deployment marker.
  try {
    const line = execSync('git log -1 --pretty=format:%H|%cI|%an|%s', { encoding: 'utf8' }).trim();
    const [ref, timestamp, author, ...rest] = line.split('|');
    const description = rest.join('|');
    if (ref) return [{ id: ref.slice(0, 8), timestamp, ref, author, description, environment: 'git' }];
  } catch {
    /* not a git repo */
  }
  log.info('No deployment events found (no deployments.json, no git history).');
  return [];
}
