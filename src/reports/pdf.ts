/**
 * Shared HTML -> PDF renderer.
 *
 * Reused by the generic dashboard, Revenue Protection dashboard, and the
 * consolidated incident investigation report so every report has the same
 * print settings and produces a directly downloadable artifact.
 */
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureDir } from '../utils/fs.js';

export interface PdfRenderOptions {
  inputHtml: string;
  outputPdf: string;
  title?: string;
  /**
   * Render the PDF using the page's SCREEN styles instead of the print
   * stylesheet, so the output looks pixel-faithful to the on-screen dashboard
   * (e.g. the dark Revenue Protection theme). Defaults to false (print theme).
   */
  preserveScreenTheme?: boolean;
}

export async function renderHtmlReportToPdf(options: PdfRenderOptions): Promise<string> {
  const inputPath = resolve(options.inputHtml);
  const outputPath = resolve(options.outputPdf);

  if (!existsSync(inputPath)) {
    throw new Error(`HTML report not found: ${inputPath}`);
  }

  await ensureDir(dirname(outputPath));

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(pathToFileURL(inputPath).href, { waitUntil: 'networkidle' });
    // Chromium's page.pdf() defaults to 'print' media. Keep 'screen' when the caller
    // wants the PDF to match the on-screen theme; otherwise use the print stylesheet.
    await page.emulateMedia({ media: options.preserveScreenTheme ? 'screen' : 'print' });
    await page.evaluate(() => document.fonts.ready);

    await page.addStyleTag({
      content: `
        @page { size: A4; margin: 14mm 11mm 16mm; }
        ${options.preserveScreenTheme
          ? 'html, body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }'
          : 'html, body { background: #fff !important; }'}
        .no-print, [data-pdf-hide] { display: none !important; }
        .card, .kpi, .hyp, .rca, svg, tr { break-inside: avoid; }
        thead { display: table-header-group; }
        h1, h2, h3 { break-after: avoid; }
        a { text-decoration: none !important; }
      `,
    });

    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `
        <div style="width:100%;font-size:8px;color:#777;padding:0 11mm;text-align:right">
          ${escapeTemplate(options.title ?? 'Website Validation Report')} - <span class="pageNumber"></span>/<span class="totalPages"></span>
        </div>`,
      margin: { top: '14mm', bottom: '16mm', left: '11mm', right: '11mm' },
    });

    return outputPath;
  } finally {
    await browser.close();
  }
}

function escapeTemplate(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char] ?? char);
}
