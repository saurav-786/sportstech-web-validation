import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { appConfig } from '../config.js';
import { ensureDir, readJson, writeJson } from '../utils/fs.js';

const HISTORY_PATH = join(appConfig.reportsDir, 'history', 'lighthouse-scores.json');

interface LhRun { timestamp: string; url: string; scores: Record<string, Record<string, number>>; }

/** Append this run's Lighthouse category scores to the history file. */
export async function recordLighthouseScores(url: string, scores: Record<string, Record<string, number>>): Promise<void> {
  const history = existsSync(HISTORY_PATH) ? await readJson<LhRun[]>(HISTORY_PATH).catch(() => []) : [];
  history.push({ timestamp: new Date().toISOString(), url, scores });
  await writeJson(HISTORY_PATH, history.slice(-100)); // keep last 100 runs
}

/** Render a Chart.js line graph of desktop+mobile category scores over time. */
export async function writeLighthouseTrend(path: string): Promise<void> {
  const history = existsSync(HISTORY_PATH) ? await readJson<LhRun[]>(HISTORY_PATH).catch(() => []) : [];
  const labels = history.map((run) => new Date(run.timestamp).toLocaleString());
  const categories = ['performance', 'accessibility', 'best-practices', 'seo'];
  const colors: Record<string, string> = { performance: '#1565c0', accessibility: '#2e7d32', 'best-practices': '#f57c00', seo: '#6a1b9a' };

  const datasets = ['desktop', 'mobile'].flatMap((ff) =>
    categories.map((cat) => ({
      label: `${ff} ${cat}`,
      data: history.map((run) => run.scores?.[ff]?.[cat] ?? null),
      borderColor: colors[cat],
      borderDash: ff === 'mobile' ? [5, 4] : [],
      spanGaps: true,
      tension: 0.3
    }))
  );

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Lighthouse Trend</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f4f6f8}
header{background:#1a237e;color:#fff;padding:18px 28px}h1{margin:0;font-size:18px}
main{max-width:1100px;margin:24px auto;background:#fff;border-radius:10px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
p{color:#607d8b;font-size:13px}</style></head>
<body><header><h1>Lighthouse Performance Trend</h1></header>
<main>
<p>${history.length} run(s). Solid = desktop, dashed = mobile. Scores 0–100; higher is better.</p>
<canvas id="c" height="120"></canvas>
<script>
new Chart(document.getElementById('c'), {
  type: 'line',
  data: { labels: ${JSON.stringify(labels)}, datasets: ${JSON.stringify(datasets)} },
  options: { responsive: true, scales: { y: { min: 0, max: 100 } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } } } }
});
</script>
</main></body></html>`;
  await ensureDir(dirname(path));
  await writeFile(path, html, 'utf8');
}
