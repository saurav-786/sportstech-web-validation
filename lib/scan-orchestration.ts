// Server-only module: imported exclusively by route handlers under app/api.
const WORKFLOW_FILE = 'dashboard-scan.yml';

export interface ScanConfig {
  token: string;
  repository: string;
  ref: string;
}

export type ScanPhase = 'queued' | 'running' | 'completed' | 'failed';

export interface ScanStatus {
  phase: ScanPhase;
  stage: string;
  progress: number | null;
  conclusion?: string | null;
}

/** Reads GitHub orchestration config from the environment, or null if unset. */
export function scanConfig(): ScanConfig | null {
  const token = process.env.GITHUB_WORKFLOW_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) return null;
  return { token, repository, ref: process.env.GITHUB_WORKFLOW_REF ?? 'main' };
}

function gh(config: ScanConfig, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://api.github.com/repos/${config.repository}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${config.token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
}

/** Returns the id of the most recent run of the dashboard scan workflow. */
export async function latestRunId(config: ScanConfig): Promise<number | null> {
  const response = await gh(config, `/actions/workflows/${WORKFLOW_FILE}/runs?per_page=1`).catch(() => null);
  if (!response?.ok) return null;
  const body = await response.json().catch(() => null);
  return body?.workflow_runs?.[0]?.id ?? null;
}

/** Dispatches the workflow. Returns true on a successful 2xx dispatch. */
export async function dispatchScan(config: ScanConfig, scanType: string): Promise<boolean> {
  const response = await gh(config, `/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ref: config.ref, inputs: { scan_type: scanType } }),
  }).catch(() => null);
  return Boolean(response?.ok);
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * GitHub's dispatch endpoint does not return the run it creates, so we poll for
 * a run whose id differs from the one observed just before dispatch. The scan
 * workflow uses a serial concurrency group, so the newest run is unambiguous.
 */
export async function resolveNewRunId(config: ScanConfig, previousId: number | null): Promise<number | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await sleep(1500);
    const id = await latestRunId(config);
    if (id && id !== previousId) return id;
  }
  return null;
}

function stageForStep(name?: string): string {
  const n = (name ?? '').toLowerCase();
  if (!n) return 'Running';
  if (/checkout|setup-node|node|npm ci|install/.test(n)) return 'Preparing';
  if (/playwright|browser/.test(n)) return 'Preparing';
  if (/execute selected profile|scan|validate/.test(n)) return 'Testing';
  if (/report|publish|vercel|deploy|summary/.test(n)) return 'Generating Report';
  return 'Running';
}

/** Maps a GitHub Actions run (and its job steps) to a dashboard scan status. */
export async function getScanStatus(config: ScanConfig, runId: string): Promise<ScanStatus | null> {
  const runResponse = await gh(config, `/actions/runs/${runId}`).catch(() => null);
  if (!runResponse?.ok) return null;
  const run = await runResponse.json().catch(() => null);
  if (!run) return null;

  if (run.status === 'completed') {
    const success = run.conclusion === 'success';
    return {
      phase: success ? 'completed' : 'failed',
      stage: success ? 'Completed' : 'Failed',
      progress: 100,
      conclusion: run.conclusion,
    };
  }

  if (['queued', 'pending', 'waiting', 'requested'].includes(run.status)) {
    return { phase: 'queued', stage: 'Queued', progress: 5 };
  }

  // in_progress — derive a real stage + coarse percentage from job steps.
  const jobsResponse = await gh(config, `/actions/runs/${runId}/jobs`).catch(() => null);
  const jobs = jobsResponse?.ok ? await jobsResponse.json().catch(() => null) : null;
  const steps: Array<{ name?: string; status?: string }> = jobs?.jobs?.[0]?.steps ?? [];
  const total = steps.length || 1;
  const completed = steps.filter((step) => step.status === 'completed').length;
  const current = steps.find((step) => step.status === 'in_progress');
  const progress = Math.max(8, Math.min(95, Math.round((completed / total) * 100)));
  return { phase: 'running', stage: stageForStep(current?.name), progress };
}
