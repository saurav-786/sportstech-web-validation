import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appConfig } from '../config.js';
import type { SiteReport, ValidationIssue, WebsiteMap } from '../types.js';
import { ensureDir, readJson, writeJson } from '../utils/fs.js';
import { writeAreaReport } from '../reports/html.js';
import { recordLighthouseScores, writeLighthouseTrend } from './trends.js';

const capturedScores: Record<string, Record<string, number>> = {};

async function runAudit(url: string, formFactor: 'desktop' | 'mobile'): Promise<ValidationIssue[]> {
  const chrome = await launch({ chromeFlags: ['--headless', '--no-sandbox'] });
  try {
    const result = await lighthouse(url, {
      port: chrome.port,
      output: 'html',
      logLevel: 'error',
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      formFactor,
      screenEmulation: formFactor === 'desktop' ? {
        mobile: false,
        width: 1350,
        height: 940,
        deviceScaleFactor: 1,
        disabled: false
      } : undefined
    });

    if (!result) return [];
    await ensureDir(join(appConfig.reportsDir, 'lighthouse'));
    await writeFile(join(appConfig.reportsDir, 'lighthouse', `${formFactor}.html`), result.report as string, 'utf8');

    const categories = result.lhr.categories;
    const issues: ValidationIssue[] = [];
    capturedScores[formFactor] = {};
    for (const [name, category] of Object.entries(categories)) {
      const score = Math.round((category.score ?? 0) * 100);
      capturedScores[formFactor][name] = score;
      if (score < 90) {
        issues.push({
          area: name === 'performance' ? 'performance' : name === 'seo' ? 'seo' : name === 'accessibility' ? 'accessibility' : 'lighthouse',
          severity: score < 50 ? 'high' : score < 75 ? 'medium' : 'low',
          pageUrl: url,
          summary: `Lighthouse ${formFactor} ${category.title} score is ${score}.`,
          suggestedFix: 'Open the detailed Lighthouse HTML report for diagnostics and opportunities.'
        });
      }
    }
    return issues;
  } finally {
    await chrome.kill();
  }
}

const map = await readJson<WebsiteMap>(join(appConfig.reportsDir, 'website-map.json')).catch(async () => {
  const { crawlWebsite } = await import('../discovery/crawler.js');
  return crawlWebsite();
});
const target = map.pages[0]?.url ?? appConfig.baseUrl;
const issues = [...await runAudit(target, 'desktop'), ...await runAudit(target, 'mobile')];
await writeJson(join(appConfig.reportsDir, 'lighthouse-issues.json'), issues);

const reportPath = join(appConfig.reportsDir, 'site-report.json');
const siteReport = JSON.parse(await readFile(reportPath, 'utf8').catch(() => JSON.stringify({
  generatedAt: new Date().toISOString(),
  baseUrl: appConfig.baseUrl,
  pagesTested: 1,
  results: [],
  issues: [],
  scores: { health: 100, seo: 100, accessibility: 100, performance: 100, security: 100 }
}))) as SiteReport;

siteReport.issues.push(...issues);
await writeFile(reportPath, `${JSON.stringify(siteReport, null, 2)}\n`, 'utf8');
await writeAreaReport(siteReport, 'lighthouse', 'Lighthouse Report', join(appConfig.reportsDir, 'lighthouse-report.html'));
await writeAreaReport(siteReport, 'performance', 'Performance Report', join(appConfig.reportsDir, 'performance-report.html'));

// Persist scores and render the trend graph across runs
await recordLighthouseScores(target, capturedScores);
await writeLighthouseTrend(join(appConfig.reportsDir, 'lighthouse-trends.html'));
console.log(`Lighthouse audited ${target}. Trend graph: reports/lighthouse-trends.html`);
