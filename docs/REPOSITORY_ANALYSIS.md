# Repository Analysis Report

Audit date: 23 June 2026.

## Executive summary

The repository is a mature Playwright/TypeScript website-validation platform rather than a frontend-only project. It already contains structured quality, commerce, revenue, RCA, trend, screenshot, trace, PDF, and HTML outputs. The dashboard implementation therefore treats generated artifacts as the system of record and does not replace or rewrite the automation framework.

Latest audited artifacts show:

- 79 PDP URLs across 6 device profiles
- 474 PDP/cart checks: 453 passed and 21 failed
- 14 unique PDP URLs with at least one failure
- 111 discovered product URLs across 8 category scans
- 1,303 structured website findings, including 320 critical findings
- Website health score 26
- Revenue health score 89 and conversion risk score 11
- 28 unit tests passing
- Lighthouse category artifact absent in the latest checked-in report set; the dashboard displays unavailable instead of a placeholder score
- Complete monetary revenue assumptions not connected; euro-loss claims remain disabled

## Repository inventory

| Area | Existing implementation |
| --- | --- |
| Automation suites | Smoke, SEO, security, performance, accessibility, visual, exploration, regression, PDP, PDP/cart, revenue, media |
| Browser matrix | Chromium, Firefox, WebKit plus named desktop/mobile/tablet profiles |
| API/network validation | Request failures, network risk, security headers, analytics and service checks |
| Lighthouse | Desktop/mobile runner, HTML output, issue JSON, historical score recorder |
| Structured reports | Site report, test results, PDP discovery, PDP/cart, revenue health, RCA, web vitals, website map |
| HTML reports | Executive, revenue, investigation, PDP, accessibility, SEO, security, performance, media, Playwright |
| PDFs | Executive, revenue, investigation, PDP discovery, PDP/cart |
| Evidence | Page, responsive, scroll, journey, test failure, trace, and Playwright media artifacts |
| AI RCA | Provider abstraction, deterministic failure classification, confidence and evidence RCA |
| Revenue protection | Funnel journeys, business assumptions, impact engine, deployment correlation |
| CI/CD | PR/nightly/weekly validation, revenue protection, Vercel deployment |
| Deployment | Previous static report site; upgraded to a Next.js dashboard while preserving report generation |

## Data quality decisions

- PDP check success is calculated from `pdp-cart-fast-summary.json`.
- Website quality and severity counts come from `site-report.json` and `revenue-health.json`.
- Trend charts use historical revenue-run and automation-history artifacts only.
- Revenue risk charts show finding counts by category when business data is incomplete.
- Lighthouse cards remain null until a Lighthouse artifact exists.
- The dashboard snapshot records metric provenance in Settings.
- Raw evidence stays in CI artifacts; a compressed stakeholder subset is deployed to Vercel.

## Components added

- Next.js App Router application under `app/`
- Shared executive shell, KPI cards, panels, charts, gauges, tables, evidence and report views
- Report normalization in `lib/dashboard/source-data.ts`
- Production snapshot reader in `lib/dashboard/data.ts`
- Build-time artifact preparation in `scripts/prepare-dashboard-assets.ts`
- Auth.js/NextAuth v5 Google OAuth and role mapping
- Dashboard API, artifact API, and scan-dispatch API
- Managed dashboard scan workflow

## Existing automation preserved

No core validator, journey, or Playwright suite was rewritten for the dashboard. The new application reads their outputs and dispatches their existing npm scripts.

## Known operational boundaries

- Vercel does not execute long-running Playwright jobs.
- The UI delegates those jobs to the managed workflow.
- Full traces/videos may exceed Vercel deployment limits and remain downloadable from CI artifacts.
- Application roles gate scan execution; page-level navigation remains visible so stakeholder roles can inspect permitted executive data.
