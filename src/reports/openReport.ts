/**
 * openReport.ts — Opens the validation dashboard in the default browser.
 *
 * Safe to call in CI: returns false without throwing when no display
 * server is available or when the CI environment variable is set.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { appConfig } from '../config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('open-report');

/** Returns true when running in a headless CI environment. */
function isHeadless(): boolean {
  return (
    process.env.CI === 'true' ||
    process.env.CI === '1' ||
    process.env.HEADLESS === '1' ||
    !process.env.DISPLAY && process.platform === 'linux'
  );
}

/**
 * Opens `path` (default: reports/dashboard.html) in the default browser.
 *
 * @returns `true` if the open command was launched, `false` if skipped
 *          (headless/CI) or if the file does not exist.
 */
export async function openReport(path?: string): Promise<boolean> {
  const target = resolve(path ?? `${appConfig.reportsDir}/dashboard.html`);

  if (!existsSync(target)) {
    log.warn(`Report not found, skipping open: ${target}`);
    return false;
  }

  if (isHeadless()) {
    log.info(`CI/headless environment detected — skipping browser open. Report: ${target}`);
    return false;
  }

  const cmd =
    process.platform === 'darwin' ? 'open' :
    process.platform === 'win32' ? 'start' :
    'xdg-open';

  return new Promise((resolve_) => {
    const child = spawn(cmd, [target], { detached: true, stdio: 'ignore' });
    child.unref();
    child.on('error', (err) => {
      log.warn(`Could not open browser (${cmd}): ${err.message}`);
      resolve_(false);
    });
    child.on('spawn', () => {
      log.info(`Opened report: ${target}`);
      resolve_(true);
    });
    // Resolve after a short delay to cover spawn latency on Windows
    setTimeout(() => resolve_(true), 500);
  });
}
