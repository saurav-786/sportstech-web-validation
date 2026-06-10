import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openReport } from '../reports/openReport.js';

function playwrightCommand(): { command: string; args: string[] } {
  const binaryName = process.platform === 'win32' ? 'playwright.cmd' : 'playwright';
  const localBinary = join(process.cwd(), 'node_modules', '.bin', binaryName);

  if (existsSync(localBinary)) {
    return { command: localBinary, args: ['test'] };
  }

  const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return { command: npxCommand, args: ['playwright', 'test'] };
}

function run(command: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.FORCE_COLOR;
    delete env.NO_COLOR;

    const child = spawn(command, args, { env, stdio: 'inherit' });

    child.on('error', (error) => {
      console.error(`Could not start ${command}: ${error.message}`);
      resolve(1);
    });

    child.on('close', (code) => {
      resolve(code ?? 1);
    });
  });
}

const extraArgs = process.argv.slice(2);
const { command, args } = playwrightCommand();

console.log('Starting website validation scan...');
const exitCode = await run(command, [...args, ...extraArgs]);

const openedReport = await openReport();

if (exitCode === 0) {
  console.log('Scan complete.');
} else if (openedReport) {
  console.log(`Scan finished with exit code ${exitCode}. The report UI was opened for review.`);
} else {
  console.log(`Scan finished with exit code ${exitCode}. Run npm run report to open the dashboard.`);
}

process.exitCode = exitCode;
