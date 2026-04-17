# MMSS 2113 — Network Survey

Collects weighted directed networks from students. Each student divides
100 whole points among their classmates, for each of several networks
(advice, friendship, status, etc.). When everyone is done, the backend
publishes CSVs as a weighted edge list.

## Architecture

- **Static site** in `docs/` (served by GitHub Pages) — the student form
  and admin dashboard. No build step.
- **Backend** in `apps-script/` — a Google Apps Script bound to a Google
  Sheet. The Sheet holds the roster, network prompts, and submissions.
  The script exposes a web-app endpoint the static site POSTs to.
- **Published CSVs** land in `docs/data/` on release, committed by the
  Apps Script via the GitHub contents API.

Each student gets a unique `?token=...` link via email; the token auths
them to fetch their classmate list and submit. Submissions are upsertable
until release.

## Layout

```
docs/               # GitHub Pages root
  index.html        # landing
  form.html         # student form  (reads ?token=)
  admin.html        # admin dashboard (requires admin token)
  form.js, admin.js, style.css
  config.js         # holds the Apps Script URL — edit after deploying
  data/             # final CSVs land here
apps-script/
  Code.gs           # backend
  appsscript.json   # manifest
  DEPLOY.md         # step-by-step deployment instructions
```

## Setup

See `apps-script/DEPLOY.md` for the full walkthrough.

Short version:
1. Create a Google Sheet, open Apps Script, paste `Code.gs` + `appsscript.json`.
2. Run `setup()`; fill in the `roster` and `networks` tabs.
3. Deploy as web app (Anyone access). Copy the URL.
4. Paste the URL into `docs/config.js`, commit, push.
5. Set Script Properties (`ADMIN_TOKEN`, `GITHUB_TOKEN`, etc.).
6. Run `sendLinks()` to email everyone their form link.
7. Watch progress on `admin.html`. CSVs auto-publish when the last student
   submits.

## Output

One CSV per network at `docs/data/<network>.csv`, plus a combined
`docs/data/all_networks.csv`:

```
network,source_id,source_name,target_id,target_name,weight
advice,s01,Alice Johnson,s02,Bob Smith,40
advice,s01,Alice Johnson,s03,Carol Zhang,60
...
```

The public URL for the combined CSV will be
`https://<owner>.github.io/<repo>/data/all_networks.csv`.
