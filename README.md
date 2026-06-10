# AI Website Validation Platform

Enterprise-grade Playwright, TypeScript, axe-core, Lighthouse, k6, and AI-assisted website validation for `https://www.sportstech.de/`.

> **Stakeholders:** the latest validation reports are published as a protected
> static site on Vercel — no local install required. Authorized reviewers can
> open the hosted URL, authenticate via Vercel Deployment Protection, and
> browse every report (executive summary, SEO, accessibility, security,
> performance, Lighthouse, Playwright). See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
> for access process, architecture, and one-time operator setup.

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
