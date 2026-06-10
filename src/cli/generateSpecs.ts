import { generateSpecsFromReport } from '../ai/specGenerator.js';

const files = await generateSpecsFromReport();
console.log(files.length ? `Generated:\n${files.join('\n')}` : 'No specs generated (run a scan first).');
process.exit(0);
