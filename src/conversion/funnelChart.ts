/**
 * funnelChart.ts — Phase 3: self-contained inline SVG funnel visualization.
 * No external deps (matches the project's shareable-report philosophy).
 */
import type { FunnelMetrics } from '../types.js';

function barColour(healthy: boolean, dropOffRate: number): string {
  if (!healthy && dropOffRate >= 0.6) return '#d32f2f';
  if (!healthy) return '#f57c00';
  return '#2e7d32';
}

export function renderFunnelSvg(funnel: FunnelMetrics, theme: 'light' | 'dark' = 'light'): string {
  const rowH = 46;
  const gap = 10;
  const width = 720;
  const labelW = 150;
  const barMax = width - labelW - 120;
  const rows = funnel.stages;
  const height = rows.length * (rowH + gap) + 20;
  const labelColour = theme === 'dark' ? '#dbe4f4' : '#333';
  const metricColour = theme === 'dark' ? '#aab6d6' : '#555';

  const bars = rows.map((s, i) => {
    const y = 10 + i * (rowH + gap);
    const widthPx = Math.max(2, Math.round((s.entered > 0 ? (s.continued / Math.max(1, rows[0].entered)) : 0) * barMax));
    const enteredPx = Math.max(2, Math.round((s.entered / Math.max(1, rows[0].entered)) * barMax));
    const colour = barColour(s.healthy, s.dropOffRate);
    return `
      <g>
        <text class="funnel-label" x="0" y="${y + 28}" font-size="13" fill="${labelColour}" font-weight="600">${s.label}</text>
        <rect x="${labelW}" y="${y + 8}" width="${enteredPx}" height="${rowH - 16}" rx="4" fill="#e0e0e0"/>
        <rect x="${labelW}" y="${y + 8}" width="${widthPx}" height="${rowH - 16}" rx="4" fill="${colour}"/>
        <text class="funnel-metric" x="${labelW + enteredPx + 8}" y="${y + 28}" font-size="12" fill="${metricColour}">
          ${s.entered} → ${s.continued} (${(s.rate * 100).toFixed(0)}%)
        </text>
      </g>`;
  }).join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Conversion funnel">
    ${bars}
  </svg>`;
}
