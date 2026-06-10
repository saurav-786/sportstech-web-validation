import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { appConfig } from '../config.js';
import { buildShareableReport } from '../reports/shareReport.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('share');

/**
 * Produces shareable artifacts for Teams/email/wiki:
 *  1. reports/dashboard-shareable.html — single self-contained file (default).
 *  2. With `--zip`, also a reports/website-validation-report.zip bundling all HTML
 *     reports + screenshot evidence (excludes Playwright traces/videos to stay small).
 */
const single = await buildShareableReport();
if (single) log.info(`✅ Single-file report ready to attach in Teams: ${single}`);

if (process.argv.includes('--zip')) {
  const zipPath = resolve(appConfig.reportsDir, 'website-validation-report.zip');
  const args = ['-r', '-q', zipPath, '.',
    '-x', 'playwright-report/*', '-x', '*.webm', '-x', '*.zip', '-x', 'history/*'];
  const child = spawn('zip', args, { cwd: appConfig.reportsDir, stdio: 'inherit' });
  child.on('error', () => log.warn('`zip` not available on this OS — share the single HTML file or zip reports/ manually.'));
  child.on('close', (code) => {
    if (code === 0 && existsSync(zipPath)) log.info(`✅ Evidence bundle: ${zipPath}`);
  });
}
