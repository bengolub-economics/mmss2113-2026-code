# Deploying the network-survey backend

The backend is a Google Apps Script bound to a Google Sheet. The Sheet is the
database; the Apps Script exposes a web-app endpoint that the static form on
GitHub Pages talks to, and pushes published CSVs back to this repo.

This file walks through the full setup, top to bottom.

---

## 1. Create the Sheet and paste the code

1. In Google Drive, create a new Google Sheet. Name it e.g.
   `MMSS 2113 2026 — Network Survey`.
2. `Extensions` → `Apps Script`.
3. In the Apps Script editor, delete the placeholder `Code.gs` and paste in the
   contents of `apps-script/Code.gs` from this repo.
4. Click the gear icon (`Project Settings`) and tick
   **"Show `appsscript.json` manifest file in editor"**. Replace its contents
   with `apps-script/appsscript.json` from this repo.
5. Save everything.

## 2. Run `setup()` to create the sheet tabs

Back in `Code.gs`, select the function `setup` from the dropdown and click
**Run**. You'll be asked to grant permissions — allow them. This creates four
tabs in the Sheet:

- `roster` — student_id, name, email, token
- `networks` — id, title, prompt
- `submissions` — (auto-populated)
- `config` — published (false), release_mode (auto)

Sample rows are seeded; replace them with your real data.

## 3. Fill in the roster and networks

On the **roster** tab, add one row per student:

| student_id | name          | email              | token |
|-----------:|---------------|--------------------|-------|
| s01        | Alice Johnson | alice@u.edu        | (leave blank — generated) |
| s02        | Bob Smith     | bob@u.edu          |       |
| …          | …             | …                  |       |

- `student_id` is what will appear in the output CSV — pick anonymous IDs
  (e.g. `s01`) if you don't want names leaking publicly.
- Leave `token` blank; run `generateMissingTokens()` from the editor and every
  blank token will be filled with a unique random string.

On the **networks** tab, edit the seeded rows. Each row defines one network:

| id          | title      | prompt (shown to students)                                    |
|-------------|------------|---------------------------------------------------------------|
| advice      | Advice     | Divide 100 points among your classmates to indicate who …     |
| friendship  | Friendship | Divide 100 points among your classmates based on how close …  |
| status      | Status     | Divide 100 points among your classmates based on how much …   |

Add, remove, or reword rows as you like. The `id` becomes the filename
(`advice.csv`, etc.).

## 4. Deploy as a web app

1. In Apps Script: **Deploy** → **New deployment**.
2. Type: **Web app**.
3. Description: `Network survey v1`.
4. Execute as: **Me (your account)**.
5. Who has access: **Anyone** (or *Anyone within your org* if the whole class
   has accounts there — but the anonymous option is simpler).
6. Click **Deploy**. Copy the **Web app URL** (looks like
   `https://script.google.com/macros/s/AKfycb…/exec`).

When you later change `Code.gs`, use **Deploy → Manage deployments**, pick the
existing deployment, click the pencil, bump the version, and deploy. The URL
stays the same.

## 5. Paste the URL into `docs/config.js`

Edit `docs/config.js` in this repo:

```js
window.APP_CONFIG = {
  scriptUrl: "https://script.google.com/macros/s/AKfycb…/exec"
};
```

Commit and push. GitHub Pages will rebuild within a minute.

## 6. Set Script Properties

In Apps Script: gear icon → **Project Settings** → scroll to **Script
Properties** → **Add script property**. Add each of:

| Key              | Value                                                      |
|------------------|------------------------------------------------------------|
| `ADMIN_TOKEN`    | any random string (used to log in to `admin.html`)         |
| `ADMIN_EMAIL`    | your email, for completion notifications                   |
| `FORM_URL`       | `https://<user>.github.io/<repo>/form.html`                |
| `GITHUB_OWNER`   | `bengolub-economics`                                       |
| `GITHUB_REPO`    | the repo name (e.g. `mmss2113-2026-code`)                  |
| `GITHUB_BRANCH`  | `main`                                                     |
| `GITHUB_TOKEN`   | a GitHub fine-grained PAT — see below                      |

### Creating the GitHub token

1. GitHub → Settings → Developer settings → **Personal access tokens** →
   **Fine-grained tokens** → **Generate new token**.
2. Resource owner: your account / org that owns the repo.
3. Repository access: **Only select repositories** → pick this repo only.
4. Permissions → Repository permissions → **Contents: Read and write**.
   Everything else can stay **No access**.
5. Set an expiration date (after the end of the semester is fine).
6. Generate, copy the token, paste it as `GITHUB_TOKEN` in Script Properties.

## 7. Email the links

Run the `sendLinks()` function from the editor. Each student in the roster
gets an email with their unique `form.html?token=…` link. You can re-run it
safely — it just re-emails.

## 8. Monitor progress

Visit `https://<user>.github.io/<repo>/admin.html`, paste the `ADMIN_TOKEN`,
and you'll see per-network completion counts and who's missing. When the last
student submits, the backend:

1. Builds one CSV per network plus a combined `all_networks.csv`.
2. Commits them to `docs/data/` on `main` using the GitHub token.
3. Emails `ADMIN_EMAIL`.

CSVs are then public at
`https://<user>.github.io/<repo>/data/all_networks.csv`.

If you want to release early, click **Force-publish now** on the admin page.

## Notes / gotchas

- **Re-deploying Apps Script**: always use *Manage deployments → edit existing*,
  not *New deployment*, or the URL changes and you'd have to update
  `docs/config.js` again.
- **Quotas**: Gmail (100 emails/day for consumer accounts, 1,500 for Workspace),
  URL fetches (20k/day), script runtime (90 min/day). All comfortably above a
  classroom-size survey.
- **If auto-publish fails** (e.g. bad GitHub token), student submissions still
  succeed. Fix the token and use **Force-publish now** on the admin page.
- **CORS**: the form POSTs with `Content-Type: text/plain` on purpose so the
  browser doesn't trigger a CORS preflight (Apps Script handles simple
  requests; preflights are unreliable). Don't change that header.
