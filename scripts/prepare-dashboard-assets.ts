import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import sharp from 'sharp';

process.env.DASHBOARD_PREPARING = '1';
const { getDashboardSnapshot } = await import('../lib/dashboard/source-data.js');

const root = resolve(import.meta.dirname, '..');
const publicDir = join(root, 'public');
const artifactsDir = join(publicDir, 'artifacts');
await mkdir(publicDir, { recursive: true });
await rm(artifactsDir, { recursive: true, force: true });
await mkdir(artifactsDir, { recursive: true });

const snapshot = await getDashboardSnapshot();
const selected = new Set<string>();

for (const report of snapshot.reports) {
  if (
    report.path.startsWith('reports/')
    && !report.path.includes('/playwright-report/')
    && report.type !== 'ZIP'
  ) {
    selected.add(report.path);
  }
}

for (const item of snapshot.evidence.filter((entry) => entry.kind === 'screenshot').slice(0, 30)) {
  selected.add(item.path);
}

for (const finding of snapshot.findings) {
  if (finding.screenshot) selected.add(finding.screenshot);
}

let copied = 0;
const copiedSizes = new Map<string, number>();
for (const sourcePath of selected) {
  const source = join(root, sourcePath);
  if (!existsSync(source)) continue;
  const extension = extname(source).toLowerCase();
  if (!['.html', '.pdf', '.json', '.csv', '.zip', '.png', '.jpg', '.jpeg', '.webp'].includes(extension)) continue;
  const destination = join(artifactsDir, sourcePath);
  await mkdir(dirname(destination), { recursive: true });
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
    const image = sharp(source).resize({ width: 1200, withoutEnlargement: true });
    if (extension === '.png') await image.png({ compressionLevel: 9, quality: 78 }).toFile(destination);
    else if (extension === '.webp') await image.webp({ quality: 78 }).toFile(destination);
    else await image.jpeg({ quality: 80, mozjpeg: true }).toFile(destination);
  } else {
    await cp(source, destination);
  }
  copiedSizes.set(sourcePath, (await stat(destination)).size);
  copied += 1;
}

snapshot.reports = snapshot.reports
  .filter((item) => selected.has(item.path))
  .map((item) => ({ ...item, size: copiedSizes.get(item.path) ?? item.size }));
snapshot.evidence = snapshot.evidence
  .filter((item) => selected.has(item.path))
  .map((item) => ({ ...item, size: copiedSizes.get(item.path) ?? item.size }));
snapshot.findings = snapshot.findings.map((finding) => ({
  ...finding,
  screenshot: finding.screenshot && selected.has(finding.screenshot) ? finding.screenshot : undefined,
  video: undefined,
}));
await writeFile(join(publicDir, 'dashboard-snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`[prepare-dashboard-assets] snapshot + ${copied} curated artifacts prepared`);
