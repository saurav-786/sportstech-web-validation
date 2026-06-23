/**
 * summaryReporter.ts — console + JSON summary for the @pdp-cart-fast suite.
 *
 * Prints, at the end of the run:
 *   • Total PDP URLs found (and device profiles)
 *   • Passed add-to-cart count
 *   • Failed PDP URLs with the reason for each failure
 *   • Total execution time
 *
 * Registered globally in playwright.config.ts but self-guards: it only collects
 * results from the pdp-cart spec, so other suites are unaffected (it stays silent).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

interface Row {
  device: string;
  url: string;
  status: TestResult['status'];
  durationMs: number;
  reason?: string;
  retries: number;
}

function isPdpCart(test: TestCase): boolean {
  return /pdp-cart\.spec\.ts$/.test(test.location.file);
}

function annotation(test: TestCase, type: string): string | undefined {
  return test.annotations.find((a) => a.type === type)?.description;
}

function firstLine(s?: string): string {
  if (!s) return 'unknown';
  // Strip ANSI color codes Playwright adds to error messages, keep the first line.
  return s.replace(/\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? 'unknown';
}

export default class PdpCartSummaryReporter implements Reporter {
  private rows = new Map<string, Row>();
  private startedAt = 0;

  onBegin(): void {
    this.startedAt = Date.now();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (!isPdpCart(test)) return;
    // Device = Playwright project name (titlePath()[1]); URL = test title.
    const projectName = test.titlePath()[1];
    this.rows.set(test.id, {
      device: annotation(test, 'pdp-device') ?? projectName ?? '—',
      url: annotation(test, 'pdp-url') ?? test.title,
      status: result.status,
      durationMs: result.duration,
      reason: result.status === 'passed' ? undefined : firstLine(result.error?.message),
      retries: result.retry,
    });
  }

  onEnd(_result: FullResult): void {
    if (this.rows.size === 0) return; // no pdp-cart tests in this run — stay quiet.

    const rows = [...this.rows.values()];
    const passed = rows.filter((r) => r.status === 'passed');
    const skipped = rows.filter((r) => r.status === 'skipped');
    const failed = rows.filter((r) => r.status !== 'passed' && r.status !== 'skipped');
    const uniqueUrls = new Set(rows.map((r) => r.url)).size;
    const devices = new Set(rows.map((r) => r.device)).size;
    const totalMs = Date.now() - this.startedAt;

    const line = '─'.repeat(72);
    const out: string[] = [];
    out.push('');
    out.push(line);
    out.push('  PDP ADD-TO-CART — SUMMARY');
    out.push(line);
    out.push(`  PDP URLs found ........ ${uniqueUrls}  (across ${devices} device profile${devices === 1 ? '' : 's'})`);
    out.push(`  Add-to-cart checks .... ${rows.length} total`);
    out.push(`  Passed ................ ${passed.length}`);
    out.push(`  Failed ................ ${failed.length}`);
    if (skipped.length) out.push(`  Skipped ............... ${skipped.length}`);
    out.push(`  Total execution time .. ${(totalMs / 1000).toFixed(1)}s`);

    // Slowest PDPs (perf diagnostics) — top 5 by duration.
    const slowest = rows.slice().sort((a, b) => b.durationMs - a.durationMs).slice(0, 5);
    if (slowest.length) {
      out.push('');
      out.push('  SLOWEST PDPs:');
      for (const r of slowest) out.push(`   ${(r.durationMs / 1000).toFixed(1)}s  [${r.device}] ${r.url}`);
    }

    // Retried / flaky PDPs.
    const retried = rows.filter((r) => r.retries > 0);
    if (retried.length) {
      out.push('');
      out.push(`  RETRIED PDPs (${retried.length}):`);
      for (const r of retried.slice(0, 15)) out.push(`   ↻ ${r.retries}x [${r.device}] ${r.url} (${r.status})`);
    }

    if (failed.length) {
      out.push('');
      out.push('  FAILED ADD-TO-CART:');
      for (const r of failed.slice().sort((a, b) => a.device.localeCompare(b.device))) {
        out.push(`   ✗ [${r.device}] ${r.url}`);
        out.push(`       → ${r.reason}`);
      }
    } else {
      out.push('');
      out.push('  ✓ Every PDP added to cart on every device profile.');
    }
    out.push(line);
    out.push('');

    // eslint-disable-next-line no-console
    console.log(out.join('\n'));

    // Machine-readable summary alongside the other reports.
    const summaryPath = join(process.env.REPORTS_DIR ?? 'reports', 'pdp-cart-fast-summary.json');
    try {
      if (!existsSync(dirname(summaryPath))) mkdirSync(dirname(summaryPath), { recursive: true });
      writeFileSync(
        summaryPath,
        `${JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            totalUrls: uniqueUrls,
            deviceProfiles: devices,
            totalChecks: rows.length,
            passed: passed.length,
            failed: failed.length,
            skipped: skipped.length,
            totalMs,
            results: rows.map((r) => ({
              device: r.device,
              url: r.url,
              status: r.status,
              durationMs: r.durationMs,
              retries: r.retries,
              reason: r.reason,
            })),
            failures: failed.map((r) => ({ device: r.device, url: r.url, reason: r.reason })),
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
    } catch {
      /* summary file is best-effort */
    }
  }
}
