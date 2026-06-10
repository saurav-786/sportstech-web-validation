# Deployment — Hosted Report Viewer

This project is a CLI Playwright validation framework. The generated reports
are published as a **protected static site on Vercel** so non-technical
stakeholders can review results in a browser without installing Node.js, npm,
or any local tooling.

This document covers:

1. [Access process](#access-process) — how reviewers reach the reports.
2. [Architecture](#architecture) — how the deploy pipeline is wired.
3. [How reports are updated](#how-reports-are-updated) — triggers and cadence.
4. [One-time setup](#one-time-setup) — what an operator does once to provision Vercel.
5. [Authentication configuration](#authentication-configuration) — Vercel Deployment Protection options.
6. [Operations](#operations) — manual deploys, troubleshooting, rollbacks.
7. [Future Option B path](#future-option-b-path) — what to add when richer features are needed.

---

## Access process

1. The hosted URL (e.g. `https://sportstech-web-validation.vercel.app/` or a
   custom domain) is shared with authorized reviewers.
2. The first time a reviewer opens the URL, Vercel Deployment Protection
   prompts them to authenticate.
   - **Vercel Authentication** — reviewer signs in with the email associated
     with their Vercel team membership (preferred for internal reviewers).
   - **Password Protection** — reviewer enters a shared password (for
     external reviewers without Vercel accounts).
3. After authentication, the landing page lists every available report (main
   dashboard, executive summary, SEO, accessibility, security, performance,
   Lighthouse, Playwright test report, executive PDF, …).
4. No local installation is required.

Per-stakeholder onboarding checklist (operator):

- Add the reviewer's email to the Vercel team OR share the protection password.
- Send the hosted URL.
- Optionally point them at the relevant report tile (most stakeholders only
  want **Executive Summary** or **Main Dashboard**).

---

## Architecture

```
┌──────────────────────┐    nightly @ 02:00 UTC    ┌─────────────────────────────┐
│ GitHub Actions       │ ────────────────────────▶ │ Website Validation workflow │
│ (sportstech-web-     │                            │  - npm ci                   │
│  validation repo)    │                            │  - playwright install       │
└──────────────────────┘                            │  - npm run scan             │
                                                    │  - upload reports/ artifact │
                                                    └──────────────┬──────────────┘
                                                                   │ workflow_run: success
                                                                   ▼
                                                    ┌─────────────────────────────┐
                                                    │ Deploy Reports to Vercel    │
                                                    │  - download artifact        │
                                                    │  - run scripts/build-       │
                                                    │    vercel-site.mjs          │
                                                    │  - vercel build --prod      │
                                                    │  - vercel deploy --prebuilt │
                                                    └──────────────┬──────────────┘
                                                                   │
                                                                   ▼
                                                  ┌───────────────────────────────┐
                                                  │ Vercel (static hosting)       │
                                                  │  - global CDN, HTTPS enforced │
                                                  │  - Deployment Protection      │
                                                  │  - immutable per-deploy URL   │
                                                  │  - production alias updated   │
                                                  └───────────────────────────────┘
                                                                   │
                                                                   ▼
                                                            Authorized reviewer
```

### Files involved

| File | Role |
| --- | --- |
| `vercel.json` | Static-only project config: build command, output dir, security headers, `noindex` `X-Robots-Tag`. |
| `.vercelignore` | Keeps source / tests / secrets out of the deploy bundle. |
| `scripts/build-vercel-site.mjs` | Pure Node script. Copies `reports/` → `dist/`, writes `index.html` (landing) and `manifest.json` (metadata). |
| `.github/workflows/deploy-reports.yml` | Deploy workflow with `workflow_run` (automatic) + `workflow_dispatch` (manual) triggers. |
| `.github/workflows/website-validation.yml` | Existing scan workflow — **not modified**; the deploy listens to its completion. |
| `docs/DEPLOYMENT.md` | This document. |

### What the build produces

```
dist/
├── index.html                  ← landing page (links to every report)
├── manifest.json               ← scan metadata: timestamp, sha, list of reports
├── robots.txt                  ← Disallow: /  (this is a private review site)
├── dashboard.html              ← copied from reports/
├── executive-dashboard.html
├── dashboard-shareable.html
├── website-map.html
├── seo-report.html
├── accessibility-report.html
├── security-report.html
├── performance-report.html
├── lighthouse-report.html
├── lighthouse-trends.html
├── image-validation-report.html
├── heatmap-report.html
├── analytics-report.html
├── page-exploration-report.html
├── executive-summary.pdf
├── playwright-report/          ← traces / screenshots / videos
└── …screenshots, history, JSON evidence…
```

The build script **gracefully degrades**: if `reports/` is missing or empty
(scan failed entirely), the landing page renders an explicit "no reports
available yet" state with a link to the upstream CI run. The deploy itself
succeeds so the URL never 404s.

---

## How reports are updated

| Trigger | Cadence | Target | Source of reports |
| --- | --- | --- | --- |
| `Website Validation` nightly success | 02:00 UTC daily | **production** | Downloaded from the upstream nightly artifact |
| Manual dispatch (`smoke` profile) | On demand | preview or production | Fresh smoke scan (~5 min) |
| Manual dispatch (`full` profile) | On demand | preview or production | Fresh full crawl (~30–60 min) |

The weekly deep scan (`weekly-deep-scan.yml`) is intentionally **not** auto-
deployed — its outputs are per-suite slices, not the canonical full-site
snapshot. If a reviewer needs to see the weekly cross-browser results, an
operator can trigger a manual `full` deploy or download the weekly artifact
from the Actions UI.

---

## One-time setup

These steps are done **once** by an operator with Vercel access. Subsequent
deploys are fully automated.

### 1. Create the Vercel project

From a local clone of this repo:

```bash
npm install --global vercel@latest
vercel login                       # browser-based; pick the Vercel account/team

vercel link                        # interactive — name the project,
                                   # confirm the team, accept defaults.
                                   # Writes .vercel/project.json locally.
```

After `vercel link`, capture the values for the GitHub secrets:

```bash
cat .vercel/project.json
# { "orgId": "team_xxx...", "projectId": "prj_xxx..." }
```

### 2. Configure GitHub Actions secrets

In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**.

| Secret | Value | Required |
| --- | --- | --- |
| `VERCEL_TOKEN` | Token from <https://vercel.com/account/tokens> (scope: full or limited to this project) | Yes |
| `VERCEL_ORG_ID` | `orgId` from `.vercel/project.json` | Yes |
| `VERCEL_PROJECT_ID` | `projectId` from `.vercel/project.json` | Yes |
| `ANTHROPIC_API_KEY` | Claude API key | Optional (AI enrichment) |
| `OPENAI_API_KEY` | OpenAI API key | Optional (AI enrichment) |
| `SLACK_WEBHOOK` | Slack webhook for failure notifications | Optional |

### 3. Enable Deployment Protection (see next section)

### 4. Verify

Trigger a manual deploy to confirm the pipeline works end-to-end:

1. GitHub UI → **Actions** → **Deploy Reports to Vercel** → **Run workflow**.
2. Inputs: `scan_profile=smoke`, `target=preview`.
3. Wait ~5–8 minutes.
4. Open the preview URL printed in the workflow summary. You should be
   challenged by Deployment Protection, then see the landing page.

If everything works, the next nightly run (02:00 UTC) will publish to
production automatically.

---

## Authentication configuration

We use **Vercel Deployment Protection** rather than building application-level
authentication. This means no auth code, no NextAuth/Clerk to maintain, no
session management — Vercel enforces auth at the edge before any static file
is served.

### Option 1 (preferred): Vercel Authentication

Best for internal reviewers who already have (or can have) a Vercel account
on your team.

1. Open the project in the Vercel dashboard.
2. **Settings → Deployment Protection → Vercel Authentication**.
3. Choose protection scope:
   - **Standard Protection** — protects all preview deployments and
     production. Recommended for an internal-only review site.
   - **All Deployments** — protects every URL including aliases.
4. Save.

Reviewers must be either:
- Members of the Vercel team that owns this project, **or**
- Added as Project Members (Vercel Pro: under **Settings → Members**), **or**
- Invited via Shareable Links (time-limited URLs that bypass team membership).

### Option 2: Password Protection

Best for external reviewers (auditors, agency stakeholders) who shouldn't be
added to the Vercel team.

1. Vercel dashboard → project → **Settings → Deployment Protection →
   Password Protection**.
2. Set a password. Choose protection scope (production only, or all
   deployments).
3. Distribute the password out-of-band (1Password, secure email, etc.).

Vercel rotates the protection cookie automatically; you can manually revoke
all sessions by changing the password.

### Option 3 (advanced): OIDC SSO

Available on Vercel Enterprise. Lets you delegate auth to Google Workspace,
Okta, Azure AD, etc. No code changes required on our side — configured in
the Vercel dashboard. Use this if/when stakeholders need to use corporate SSO.

### Verifying protection is active

```bash
curl -I https://<your-deployment>.vercel.app/
# Should return 401 with a Set-Cookie for the Vercel auth challenge,
# NOT 200 with the page contents.
```

---

## Operations

### Manual deploy

GitHub UI → **Actions → Deploy Reports to Vercel → Run workflow**.

- **Scan profile**:
  - `smoke` — fast smoke suite, ~5 min. Use to refresh stakeholder views
    quickly during the day.
  - `full` — full crawl + Lighthouse + PDF, ~30–60 min. Use when you need
    parity with the nightly snapshot.
- **Target**:
  - `preview` — assigns a new preview URL. Use for testing changes to the
    deploy infra itself.
  - `production` — overwrites the production alias. Use for stakeholder-facing
    updates.

### Rollback

Vercel keeps every deployment as an immutable URL. To revert to a previous
report:

1. Vercel dashboard → project → **Deployments**.
2. Find the deployment you want to make current.
3. Click **⋯ → Promote to Production**.

The production alias swaps atomically; no rebuild needed.

### Inspecting the latest deploy

```bash
vercel ls --token=<token>          # list recent deployments
vercel inspect <deployment-url> --token=<token>
```

Or from the Actions summary — every deploy run prints the resulting URL in
the workflow summary.

### Common failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Workflow skipped, no deploy | `workflow_run` upstream was a PR or failed | Expected — PR scans don't publish. Run manual deploy if needed. |
| `vercel pull` fails with 401 | `VERCEL_TOKEN` invalid or expired | Regenerate token, update GitHub secret |
| `vercel pull` fails with "no project" | `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` mismatch | Re-run `vercel link` locally, copy new IDs into GitHub secrets |
| Landing page says "No reports available yet" | Upstream scan crashed before writing any HTML | Check upstream nightly run logs; the deploy still works so site stays reachable |
| 401 in browser, but you're the reviewer | Not in Vercel team / wrong account | Operator adds you under Settings → Members |
| Reports look stale | Browser cached an old deploy | Hard reload (Cmd-Shift-R / Ctrl-F5); production alias updates within seconds of deploy |

### Disabling auto-deploy temporarily

If you need to pause production publishes (e.g., during a known scan
regression) without removing the workflow:

```bash
# In the deploy workflow file, set:
#   if: false
# at the job level. Commit and push. Re-enable later.
```

Or pause the workflow from GitHub UI → Actions → Deploy Reports to Vercel →
"⋯" → Disable workflow.

---

## Future Option B path

The deployment is structured so a richer "Option B" portal (historical
browsing, multiple snapshots, scan-trigger UI) can be added without
re-architecting:

1. **`manifest.json` is already published** at the site root with each
   deploy. It carries `generatedAt`, git sha, scan type, list of available
   reports, and the upstream CI run URL. A future Next.js portal can read
   it client-side or server-side.
2. **History preservation**: today the nightly artifact already includes
   `reports/history/` (trend snapshots). When moving to Option B, route the
   nightly artifact through Vercel Blob so multiple snapshots are accessible
   instead of just "latest".
3. **Promotion to a Next.js app**: drop a Next.js project into a `portal/`
   sibling, set `outputDirectory` in `vercel.json` accordingly. The build
   script can be reused as a portal data-source.
4. **Triggering scans from the UI** would use the Vercel Workflow DevKit to
   call `workflow_dispatch` on this repo's `deploy-reports.yml`.

None of this needs to happen now. The current setup satisfies the stated
acceptance criteria; promote when there's a demonstrated stakeholder need.
