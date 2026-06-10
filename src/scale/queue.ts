import { appConfig } from '../config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('queue');

/**
 * Distributed crawl/validation queue for very large sites (50k+ pages).
 *
 * Architecture:
 *   Producer enqueues page URLs → Redis (BullMQ) → N worker nodes pull jobs,
 *   validate one page each, and write per-page issue JSON to reports/issues/.
 *   Then `npm run report:suites` aggregates into the AI dashboard.
 *
 * bullmq + ioredis are OPTIONAL deps (the single-machine parallel crawler covers
 * up to ~10k pages without them). Install only when you need horizontal scale:
 *   npm i bullmq ioredis
 *   docker run -p 6379:6379 redis     # or any managed Redis
 *
 * Run:
 *   REDIS_URL=redis://host:6379 npm run queue:enqueue     # one producer
 *   REDIS_URL=redis://host:6379 npm run queue:work        # on each worker node (scale horizontally)
 */

const QUEUE_NAME = 'website-validation';

// Non-literal specifier → tsc treats the module as `any`, so the optional dep
// is not required to be installed for the core project to typecheck/build.
async function loadBullMq(): Promise<any | null> {
  const pkg = 'bullmq';
  try {
    return await import(pkg);
  } catch {
    log.error('bullmq is not installed. Run `npm i bullmq ioredis` to use the distributed queue.');
    return null;
  }
}

function connection() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
  return { host: url.hostname, port: Number(url.port || 6379), password: url.password || undefined };
}

/** Producer: discover the site and enqueue one validation job per page. */
export async function enqueuePages(): Promise<void> {
  const bull = await loadBullMq();
  if (!bull) process.exit(1);

  const { crawlWebsite } = await import('../discovery/crawler.js');
  const map = await crawlWebsite();
  const queue = new bull.Queue(QUEUE_NAME, { connection: connection() });

  const targets = process.env.INCREMENTAL === '1' ? map.pages.filter((page) => page.changed !== false) : map.pages;
  await queue.addBulk(targets.map((page) => ({
    name: 'validate-page',
    data: { url: page.url, category: page.category },
    opts: { attempts: 2, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: 1000, removeOnFail: 5000 }
  })));

  log.info(`Enqueued ${targets.length} page job(s) to "${QUEUE_NAME}" on ${process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'}.`);
  await queue.close();
}

/** Worker: pull page jobs and validate. Run this process on as many nodes as you need. */
export async function startWorker(): Promise<void> {
  const bull = await loadBullMq();
  if (!bull) process.exit(1);

  const { chromium } = await import('@playwright/test');
  const { validatePage } = await import('./validatePage.js');
  const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 3);
  const browser = await chromium.launch();

  const worker = new bull.Worker(QUEUE_NAME, async (job: { data: { url: string } }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const issues = await validatePage(context, job.data.url);
      return { url: job.data.url, issueCount: issues.length };
    } finally {
      await context.close();
    }
  }, { connection: connection(), concurrency });

  worker.on('completed', (job: any, result: any) => log.info(`✓ ${result.url} (${result.issueCount} issues)`));
  worker.on('failed', (job: any, error: Error) => log.error(`✗ ${job?.data?.url}: ${error.message}`));
  log.info(`Worker online (concurrency ${concurrency}) on queue "${QUEUE_NAME}". Ctrl+C to stop.`);

  process.on('SIGINT', async () => { await worker.close(); await browser.close(); process.exit(0); });
}

void appConfig; // keep config side-effects (env loading) in scope
