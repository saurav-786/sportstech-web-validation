/** Remove only run-scoped revenue artifacts so reports never mix old devices with the current run. */
import { join } from 'node:path';
import { ensureDir } from '../utils/fs.js';
import { revenueRunDir, revenueRunId } from '../revenue/runArtifacts.js';

const runDir = revenueRunDir();
const journeys = join(runDir, 'journeys');
await ensureDir(journeys);
await ensureDir(join(runDir, 'media'));
console.log(`Revenue run ${revenueRunId()}: ${runDir}`);
