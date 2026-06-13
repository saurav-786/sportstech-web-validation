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