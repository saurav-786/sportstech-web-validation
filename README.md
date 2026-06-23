# AI Website Validation Platform

Enterprise-grade Playwright, TypeScript, axe-core, Lighthouse, k6, AI-assisted website validation, and a production Next.js 15 quality-intelligence dashboard for `https://www.sportstech.de/`.

> **Stakeholders:** the latest artifacts are normalized into the Sportstech AI
> Quality Intelligence Dashboard and published on Vercel. Google OAuth,
> role-based scan execution, reports, evidence, revenue analytics, and AI RCA
> are available from one URL. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Quality Intelligence Dashboard

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`.

`npm run dev` first creates a compact dashboard snapshot from the real files in
`reports/` and `test-results/`. To refresh it without restarting:

```bash
npm run dashboard:prepare
```

Main routes:

- `/` — executive dashboard
- `/website-testing` — managed scan launcher and device matrix
- `/ai-rca` — evidence-grounded root causes
- `/reports` — HTML/PDF/JSON/CSV report library
- `/revenue-analytics` — conversion and revenue-risk intelligence
- `/support-intelligence` — support-facing issue signals
- `/lighthouse` — measured Lighthouse categories
- `/evidence` — screenshot and artifact center
- `/settings` — integration health and metric provenance

The dashboard never substitutes demo values for missing report data. Missing
Lighthouse scores remain unavailable, and monetary revenue impact is disabled
until a complete verified business dataset is connected.

Repository audit: [`docs/REPOSITORY_ANALYSIS.md`](docs/REPOSITORY_ANALYSIS.md).

## What It Covers

- Discovery crawler for pages, links, navigation, menus, forms, images, videos, carousels, tabs, accordions, popups, language switchers, and dynamic content signals.
- UI validation across Chromium, Firefox, and WebKit with screenshots, videos, traces, status checks, console errors, blank page detection, image checks, broken resource checks, and form checks.
- Responsive validation for desktop, tablet, and mobile viewports.
- Accessibility validation with axe-core and WCAG severity mapping.
- SEO validation for titles, descriptions, canonical URLs, headings, social tags, robots, and structured data.
- Security header checks for CSP, HSTS, clickjacking protection, and MIME sniffing.
- Analytics and heatmap detection for GA, GTM, Meta Pixel, Hotjar, Clarity, and CrazyEgg.
- Lighthouse desktop/mobile audits.
- k6 load, stress, and spike test scenarios.
- Optional OpenAI root-cause enrichment when `OPENAI_API_KEY` is present.
- HTML dashboards, JSON evidence, Playwright artifacts, and an executive PDF.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module map and design decisions.

## Tagged Suites

Fast, focused runs alongside the full mega-scan (`npm run scan`):

```bash
npm run test:smoke         # @smoke — page availability gate (PRs)
npm run test:seo           # @seo — metadata, sitemap/robots, duplicates, canonicals
npm run test:security      # @security — headers, cookies, mixed content, XSS surface
npm run test:performance   # @performance — Core Web Vitals vs budgets (chromium)
npm run test:a11y          # @accessibility — WCAG 2.1 A/AA + keyboard/focus
npm run test:visual        # @visual — screenshot regression (baselines on first run)
npm run test:all-suites    # everything except visual + mega-scan
```

Filter by tag across directories: `TEST_TAGS="@seo|@security" npx playwright test`.

## AI Analyzer

Pluggable provider — set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` (auto-detected, or force with `AI_PROVIDER`). Produces root causes, failure classification (frontend/backend/content/seo/performance/security/environment/flaky), duplicate grouping, traffic-weighted prioritization, release-readiness verdict, and test-gap recommendations. Without a key, rule-based heuristics provide all of the above except free-text root causes.

## Analytics Import

Drop a GA4 / Search Console / server-log export (CSV or JSON) at `test-data/analytics.csv` (see `analytics.sample.csv`). Issues on high-traffic pages get up to 10× priority in the dashboard.

## Quick Start

```bash
npm install
npx playwright install
cp .env.example .env
npm run scan:smoke
npm run lighthouse
npm run pdf
```

The scan opens `reports/executive-dashboard.html` automatically after it finishes. Set `OPEN_REPORT=0` if you want to disable auto-open.

## Full Scan

```bash
MAX_PAGES=100 CRAWL_DEPTH=4 DEVICE_SET=all BROWSERS=chromium,firefox,webkit npm run scan
```

## Live Stakeholder Demo

Run a headed Chromium scan that visibly scrolls each tested page, switches unique tab controls once, checks links and controls, then opens the executive report:

```bash
npm run scan:demo
```

Open the latest dashboard manually with:

```bash
npm run report
```

## Outputs

- `reports/dashboard.html` — advanced dashboard: heat maps, trends, AI summary, severity-ranked defects
- `reports/website-map.json`
- `reports/website-map.html`
- `reports/executive-dashboard.html`
- `reports/web-vitals.json`
- `reports/history/` — per-run trend snapshots
- `reports/playwright-report/index.html`
- `reports/seo-report.html`
- `reports/accessibility-report.html`
- `reports/security-report.html`
- `reports/performance-report.html`
- `reports/analytics-report.html`
- `reports/heatmap-report.html`
- `reports/lighthouse-report.html`
- `reports/image-validation-report.html`
- `reports/executive-summary.pdf`
- `reports/revenue-dashboard.html` and `reports/revenue-report.pdf`
- `reports/investigation-report.html` and `reports/investigation-report.pdf`

## Revenue Conversion Investigation

Run the boundary-safe ecommerce journey, calculate conversion/revenue health,
and generate both the HTML dashboard and downloadable PDF:

```bash
npm run revenue
```

Run the full device matrix plus PDP media checks and generate the consolidated
incident investigation in HTML, Markdown, and PDF:

```bash
npm run investigate:full
```

Regenerate PDFs from existing HTML artifacts without rerunning tests:

```bash
npm run pdf
npm run pdf:revenue
npm run pdf:investigation
```

Revenue and conversion scores come from the current Playwright journey run.
They are not business conversion-rate metrics. Monetary exposure is disabled
unless a complete verified dataset (sessions/day, AOV, and actual CR) is
connected through `REVENUE_BUSINESS_METRICS_URL`,
`REVENUE_BUSINESS_DATA_PATH`, or explicit environment variables. Without it,
the report states:

> Business revenue estimate unavailable because live Shopware/analytics data is not connected.

Each execution writes isolated evidence under
`reports/revenue-runs/<run-id>/`, preventing concurrent or stale runs from
being mixed into the dashboard.

## Configuration

Set these values in `.env` or the shell:

- `BASE_URL`: target site, default `https://www.sportstech.de/`
- `MAX_PAGES`: crawl cap, default `50`
- `CRAWL_DEPTH`: maximum internal crawl depth, default `4`
- `DEVICE_SET`: `all` or `desktop`
- `BROWSERS`: comma-separated `chromium,firefox,webkit`
- `OPENAI_API_KEY`: enables AI root-cause enrichment
- `OPENAI_MODEL`: defaults to `gpt-4.1-mini`

## k6 Performance

Install k6, then run:

```bash
BASE_URL=https://www.sportstech.de/ npm run k6
```

The script includes 10, 50, 100, and 500 virtual user stages and writes JSON summary evidence to `reports/performance-report.json`.
