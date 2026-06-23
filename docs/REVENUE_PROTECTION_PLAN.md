# Revenue Protection Platform — Audit, Gap Analysis & Implementation Plan

**Prepared for:** sportstech-web-validation
**Date:** 2026-06-19
**Scope:** Transform the existing AI Website Validation Platform into a Production Revenue Protection Platform without breaking existing workflows.
**Status:** Plan for approval — **no code changed yet.**

---

## 0. How to read this document

This is the deliverable required by your "analyze first, plan before changes" instruction. It contains three parts:

1. **Phase 1 — Architecture Report** (what exists today, honestly assessed)
2. **Phase 1 — Gap Analysis** (current capabilities vs. Datadog/New Relic/Dynatrace/Contentsquare/Clarity/BrowserStack/Testim/Mabl)
3. **Phases 2–10 — Implementation Plan** (each phase mapped to *reuse existing module* vs *new module*, sequenced, with breaking-change risk called out)

Nothing in the existing architecture is rewritten or removed in this plan. Every new capability is additive and bolts onto the existing `ValidationIssue` → score → dashboard pipeline.

---

## 1. Architecture Report

### 1.1 Current framework structure

The platform is a Playwright + TypeScript validation engine (~4,100 LOC across `src/`) with two execution modes sharing one module library:

- **Mega-scan** (`npm run scan`) — nightly: crawl → run every validator on every page → dashboards.
- **Tagged suites** (`npm run test:<suite>`) — CI-friendly: smoke, seo, security, performance, a11y, visual.

Module inventory (verified against the tree):

| Layer | Modules | Role |
|---|---|---|
| Config | `config.ts`, `types.ts` | Env-driven budgets, device profiles, AI provider; shared `ValidationIssue`/`SiteReport` types |
| Discovery | `discovery/crawler.ts`, `pageList.ts`, `runDiscovery.ts` | BFS crawl, popup dismissal, page categorization, dedup, content hashing, incremental mode |
| Validators | `validators/*` (ui, images, forms, interactions, responsive, accessibility, seo, security, analytics, common, demoFlow) | Per-page checks returning `ValidationIssue[]` |
| Engine | `engine/scrollEngine.ts`, `overlayGuard.ts` | Mandatory TOP→BOTTOM→TOP traversal; auto-dismiss cookie/overlay |
| Site-level | `seo/siteSeo.ts`, `performance/webVitals.ts`, `lighthouse/*` | Robots/sitemap/duplicates; CWV observers; Lighthouse desktop+mobile + trends |
| Analytics | `analytics/importAnalytics.ts` | GA4/GSC CSV/JSON → per-page traffic weight (1–10) |
| AI | `ai/provider.ts`, `analyzer.ts`, `rootCause.ts`, `confidence.ts`, `specGenerator.ts` | Pluggable LLM (Anthropic/OpenAI/none), classification, dedup, prioritization, RCA enrichment, confidence re-check, spec generation |
| Scoring | `reporting/score-engine.ts`, `release-readiness.ts` | Pure, unit-tested category/health scoring + deterministic release gate |
| Reporting | `reports/siteReport.ts`, `html.ts`, `siteReport`, `renderPdf.ts`, `shareReport.ts`, `openReport.ts` | Orchestration, HTML dashboards, PDF, self-contained shareable report |
| Scale/Auth | `scale/queue.ts`, `validatePage.ts`, `auth/auth.ts` | Optional BullMQ distributed path; form/storage/custom auth |
| CLI | `cli/*` | scan, demoScan, generateSpecs, queue, setupAuth, buildSuiteReport, shareReport |
| CI/CD | `.github/workflows/*`, `Jenkinsfile`, `.gitlab-ci.yml`, `lighthouserc.json`, `vercel.json` | PR smoke / nightly full / weekly deep matrix; Vercel-published reports |

### 1.2 Existing strengths

- **Issues-as-records architecture.** Validators emit structured `ValidationIssue`s; suites assert only on severity thresholds. This is the single most important design decision — it means a Revenue Protection layer can be added purely as new issue producers + new dashboard consumers, with zero changes to the core contract.
- **Graceful AI degradation.** Everything (classification, dedup, prioritization, summaries) works heuristically with no API key; LLM enriches when a key is present. New AI RCA work inherits this for free.
- **Deterministic release gate already exists** (`release-readiness.ts`) with an explicit `blockers[]` list and journey-aware rules ("broken checkout/login/cart/subscription journey"). The *vocabulary* for revenue gating is already in the types — it is simply not fed by any real checkout/cart test yet.
- **Traffic-weighted prioritization** (`analytics/importAnalytics.ts`) already multiplies issue priority by up to 10× for high-traffic pages. This is the natural hook for revenue weighting.
- **Pure, unit-tested scoring** (`score-engine.ts`, `release-readiness.ts` with `tests/unit/*`). Safe to extend because regressions are caught.
- **Mature CI/CD across three systems** + Vercel-published reports + Slack/email hooks.
- **Scroll engine + confidence layer** already classify findings by `pageSection` (`hero|product-listing|pricing|cta|checkout|subscription|content`) and `pagePosition`. The funnel taxonomy is *already in the type system*.

### 1.3 Existing weaknesses (relative to the revenue objective)

- **The money path is explicitly excluded.** `config.ts → ignoredPaths` defaults to `/cart,/checkout,/account,/wp-admin,/logout`. The crawler and every suite skip exactly the pages that generate revenue. There is **no cart, checkout, or payment validation today.**
- **No funnel / conversion model.** There is no notion of stage-to-stage progression (view → ATC → checkout → payment → order). `conversion`/`funnel` appears nowhere in `src/` except as a CSV analytics field.
- **No revenue impact estimation.** Issues carry `businessImpact` as free text only — no users-impacted, no €/day, no confidence-scored quantification.
- **JS errors are collected but not mapped.** `validators/common.ts → collectConsoleIssues` captures console errors, but they are not correlated to funnel stage, not separated into unhandled exceptions / promise rejections / CSP violations / failed requests, and not turned into RCA.
- **No deployment correlation.** No deploy markers, no before/after regression detection, no "conversion dropped after release X" alert.
- **Mobile is viewport-only.** `responsive.ts` (36 LOC) checks layout at widths but does not run *journeys* on real device profiles (Mobile Safari/Samsung Internet engine quirks, tap-target occlusion, mobile-only checkout failure).
- **Performance is page-load CWV, not INP/field.** `webVitals.ts` covers LCP/CLS/TBT/FCP; **INP and TTFB are not first-class**, and there's no per-stage performance budget for the funnel.
- **Executive dashboard is QA-centric, not revenue-centric.** Widgets show area scores/health; there is no Revenue Health, Conversion Health, Checkout/Cart/Payment success %, or Top Revenue Risks.

### 1.4 Technical debt

- `ignoredPaths` hard-couples "don't crawl" with "don't test" — the money pages can't be tested without either crawling them destructively or adding a dedicated, idempotent journey runner (the plan does the latter).
- `reports/` has overlapping report writers (`siteReport.ts`, `html.ts`, `shareReport.ts`, plus a `dashboard.ts` referenced in ARCHITECTURE.md but not present in the current tree) — consolidation opportunity, but **out of scope** for revenue work; we add, not refactor.
- `SiteReport.scores` is a loose inline type while `CategoryScores` is a richer interface in `types.ts` — minor duplication; we extend `SiteReport` additively rather than reconcile.
- Device list in `config.ts` ≠ the device matrix requested (no iPhone SE, no explicit Samsung Browser/engine). Additive.
- No synthetic/seed test data for cart/checkout (the real site's money path can't be hammered safely) — requires a sandbox/test-account strategy (decision needed, see §4).

### 1.5 Refactoring opportunities (additive, low-risk)

- Promote `pageSection` funnel taxonomy from a scroll-engine annotation to a **first-class funnel-stage enum** reused by both validators and the conversion engine.
- Extend `ValidationIssue` with optional `revenueImpact?` and `funnelStage?` fields (optional → no breaking change).
- Introduce a `journeys/` module sibling to `validators/` for stateful multi-page flows (cart → checkout → payment), keeping single-page validators untouched.

---

## 2. Gap Analysis — vs. enterprise platforms

Legend: ✅ have · 🟡 partial · ❌ missing

| Capability | This platform | Datadog Synthetics | New Relic Synthetics | Dynatrace | Contentsquare | MS Clarity | BrowserStack | Testim | Mabl |
|---|---|---|---|---|---|---|---|---|---|
| Scripted browser checks | ✅ (Playwright) | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | ✅ |
| Multi-step **transaction/funnel** flows | ❌ | ✅ | ✅ | ✅ | 🟡 | — | 🟡 | ✅ | ✅ |
| **Checkout/payment** journey validation | ❌ | ✅ | ✅ | ✅ | — | — | 🟡 | ✅ | ✅ |
| **Conversion funnel analytics** | ❌ | 🟡 | 🟡 | ✅ | ✅ | ✅ | — | — | 🟡 |
| **Revenue impact** quantification | ❌ | 🟡 | 🟡 | ✅ (Davis AI) | ✅ | — | — | — | 🟡 |
| JS error capture | 🟡 (collected) | ✅ | ✅ | ✅ (RUM) | ✅ | ✅ | ✅ | 🟡 | ✅ |
| JS error → **business mapping** | ❌ | 🟡 | 🟡 | ✅ | ✅ | 🟡 | — | — | 🟡 |
| Core Web Vitals (LCP/CLS/FCP) | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | 🟡 | — | 🟡 |
| **INP / TTFB / field-grade perf** | 🟡 | ✅ | ✅ | ✅ | ✅ | 🟡 | — | — | — |
| Real **device/browser matrix** journeys | 🟡 (viewport) | ✅ | ✅ | ✅ | — | — | ✅ (real devices) | ✅ | ✅ |
| **Deployment correlation / regression** | ❌ | ✅ | ✅ | ✅ (Davis) | 🟡 | — | — | 🟡 | ✅ |
| AI **root cause** w/ evidence | 🟡 (text RCA) | 🟡 | 🟡 | ✅ | 🟡 | — | — | 🟡 | ✅ (auto-heal) |
| Visual regression | ✅ | 🟡 | — | — | — | — | ✅ | ✅ | ✅ |
| SEO / a11y / security checks | ✅ | 🟡 | 🟡 | 🟡 | — | — | 🟡 | — | 🟡 |
| Executive **revenue dashboard** | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | 🟡 |
| Self-healing selectors | ❌ | — | — | — | — | — | — | ✅ | ✅ |
| Session replay / heatmaps | ❌ (detects tags only) | 🟡 | 🟡 | ✅ | ✅ | ✅ | — | — | — |
| Cost / self-hosted | ✅ free/OSS | ❌ $$ | ❌ $$ | ❌ $$$ | ❌ $$$ | ✅ free | ❌ $$ | ❌ $$ | ❌ $$ |

**Net read:** the platform already matches or beats the commercial tools on *page-level technical QA* (SEO, a11y, security, visual, CWV) and on *cost/extensibility*. It is **behind specifically on the revenue dimension**: transaction funnels, checkout/payment journeys, conversion analytics, revenue quantification, deployment correlation, and a revenue-facing executive view. Phases 2–10 are scoped precisely to close those six gaps using the existing engine.

---

## 3. Implementation Plan (Phases 2–10)

Design rule for every phase: **add issue producers and dashboard consumers; never alter the `ValidationIssue` contract destructively.** All new `ValidationIssue` fields are optional. All new modules are new files. All new CI is new jobs.

### Foundational change (prerequisite for Phases 2–7)

Extend types additively in `src/types.ts`:

```ts
export type FunnelStage =
  | 'discovery' | 'product-view' | 'add-to-cart'
  | 'cart' | 'checkout' | 'payment' | 'order-complete';

export interface RevenueImpact {
  usersImpactedPct?: number;     // % of sessions affected
  funnelStage: FunnelStage;
  estDailyRevenueEur?: number;   // modeled €/day at risk
  confidence: number;            // 0–100
}
// ValidationIssue gains: funnelStage?: FunnelStage; revenueImpact?: RevenueImpact;
```

Add a sibling module tree (nothing existing moves):

```
src/journeys/      stateful multi-page flows (cart→checkout→payment)
src/conversion/    funnel model, drop-off detection, funnel viz
src/revenue/       impact estimation engine + assumptions config
src/deploy/        deployment markers + regression correlation
```

| Phase | Goal | Reuse (existing) | New | Breaking-change risk |
|---|---|---|---|---|
| **2 — Ecommerce journeys** | Validate homepage, PLP, PDP, cart, checkout, payment | `interactions.ts`, `forms.ts`, `images.ts`, `scrollEngine.ts`, `overlayGuard.ts`, `auth.ts`, `issue()` helper | `journeys/homepage.ts`, `plp.ts`, `pdp.ts`, `cart.ts`, `checkout.ts`, `payment.ts`; new `@revenue` suite `tests/revenue/` | **Low** — new suite + new files. Money-path safety handled via test account/sandbox (see §4). |
| **3 — Conversion Health Engine** | Track view→ATC→checkout→payment→order rates; funnel viz; drop-off detection; P0–P3 severity | `analytics/importAnalytics.ts` (rates already in CSV schema), `score-engine.ts` pattern, `html.ts` rendering | `conversion/funnelModel.ts`, `dropoff.ts`, `funnelChart.ts` (HTML/SVG) | **Low** — pure functions + new report section. |
| **4 — JS error detection** | Console errors, unhandled exceptions, promise rejections, failed requests, CSP; map to journey | `validators/common.ts → collectConsoleIssues` (extend), `ai/rootCause.ts` | `validators/jsErrors.ts` (typed capture), error→`funnelStage` mapper | **Low** — extends existing collector; existing behavior preserved. |
| **5 — Mobile validation** | Run journeys on iPhone 15/SE, Android S/L, Samsung Internet, iPad, Android tablet + desktop matrix | `playwright.config.ts` projects, `config.ts` devices, `responsive.ts` | New device projects (Playwright `devices[]` + WebKit/Chromium engines), mobile-journey wiring | **Low** — new Playwright projects, gated by `DEVICE_SET`. |
| **6 — Performance monitoring** | LCP/CLS/INP/FCP/TTFB + thresholds + trend charts | `performance/webVitals.ts`, `lighthouse/trends.ts`, `reports/history` | INP + TTFB collectors; per-stage budgets; reuse Chart.js trend renderer | **Low** — adds metrics to existing vitals object (optional fields). |
| **7 — Revenue impact analysis** | Per-issue: users impacted, stage, €/day, severity, confidence | `analytics` weights, `confidence.ts`, `release-readiness.ts` | `revenue/impactEngine.ts` + `revenue/assumptions.ts` (AOV, traffic, CR config) | **Low** — annotates issues; assumptions externalized to `.env`/config. |
| **8 — AI Root Cause** | Evidence-based RCA from screenshots, console, network, traces, API | `ai/provider.ts`, `analyzer.ts`, `rootCause.ts`, `confidence.ts`; Playwright trace/screenshot artifacts already captured | `ai/evidenceRca.ts` — assembles multi-signal evidence bundle per failure | **Low** — new AI path; degrades to heuristics w/o key. |
| **9 — Executive dashboard** | Revenue/Conversion/Checkout/Cart/Payment/Mobile/Perf health, Top Failures, Top Revenue Risks, Incidents, Deployments, Trends | `reports/html.ts`, `siteReport.ts`, `shareReport.ts`, `score-engine.ts` | New widget renderers appended to dashboard; new `revenue-dashboard.html` section | **Low** — additive widgets; existing dashboard untouched. |
| **10 — Deployment correlation** | Detect deploy + conversion/revenue/error change → regression alert w/ confidence | `reports/history` snapshots, `conversion` engine, `revenue` engine | `deploy/markers.ts` (read deploy events), `deploy/correlate.ts`, alert renderer + Slack hook (reuse existing webhook) | **Medium** — needs a deployment event source (decision in §4). |

### 3.1 Reporting deliverables (mapped to existing writers)

All six requested reports are produced by **extending `reports/`**, not replacing it:

1. **Executive Summary** → new section in existing dashboard + `shareReport.ts` self-contained file.
2. **QA Report** → already exists (per-area reports); unchanged.
3. **Revenue Risk Report** → new, from `revenue/impactEngine.ts`.
4. **Performance Report** → extend `lighthouse/trends.ts` + vitals.
5. **Conversion Funnel Report** → new, from `conversion/`.
6. **AI Root Cause Report** → extend `ai/rootCause.ts` output with evidence bundles.

### 3.2 Suggested sequencing

```
Foundation (types + module skeleton, ~0.5 day)
  └─ Phase 4  JS error detection        ← fastest win, pure additive, feeds everything
  └─ Phase 2  Ecommerce journeys        ← unblocks real revenue signal
        └─ Phase 6  Performance (INP/TTFB) ← measured during journeys
        └─ Phase 3  Conversion engine    ← consumes journey + analytics
              └─ Phase 7  Revenue impact ← consumes conversion + analytics
                    └─ Phase 8  AI RCA   ← consumes errors + journeys + evidence
                          └─ Phase 9  Executive dashboard ← consumes all
                                └─ Phase 10 Deployment correlation ← consumes history + dashboard
Phase 5 (mobile matrix) runs in parallel from Phase 2 onward.
```

---

## 4. Decisions required before coding

These are genuine forks where your input changes the implementation:

1. **Money-path safety.** Real `/checkout` and `/payment` cannot be exercised against production without risk. Options: (a) test/sandbox account + non-capturing payment test cards, (b) staging environment URL, (c) validate up to the payment boundary only (no real order submission). **Recommendation: (c) by default, (a) where a test account/sandbox exists.**
2. **Revenue assumptions source.** €/day estimates need verified AOV, daily sessions, and actual CR from one explicitly connected source. Static fallback values are not used in production reports; when the dataset is incomplete, only automation-derived risk scores are shown.
3. **Deployment event source (Phase 10).** Options: git tags/commits, a deploy webhook, Vercel deployment API, or a manually maintained `deployments.json`. **Recommendation: start with git + `deployments.json`, add Vercel API later.**
4. **Implementation order.** Confirm the §3.2 sequence or re-prioritize (e.g., dashboard-first for a demo).

---

## 5. Guardrails honored throughout

- Reuse existing code wherever possible (every phase lists its reuse column).
- No duplication of functionality (new modules are siblings, not rewrites).
- No breaking changes (all new `ValidationIssue`/`SiteReport` fields optional; new suites gated by env).
- Existing workflows preserved (smoke/nightly/weekly untouched; new `@revenue` jobs added separately).
- No features removed.
- Current architecture followed (issues-as-records, pluggable AI, traffic weighting, deterministic gate).
```
