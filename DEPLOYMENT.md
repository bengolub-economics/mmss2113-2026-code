# Deployment — MMSS 2113 Network Survey

Pre-filled for this specific deployment. For the generic walkthrough see
[`apps-script/DEPLOY.md`](apps-script/DEPLOY.md).

## What's already done

- GitHub repo: https://github.com/bengolub-economics/mmss2113-2026-code
- GitHub Pages site (from `/docs`):
  https://bengolub-economics.github.io/mmss2113-2026-code/
- Google Sheet created; Apps Script pasted; `setup()` run (tabs created).
- Apps Script deployed as web app. URL:
  `https://script.google.com/macros/s/AKfycbz9XGpJpwcgmrtD_6K9aV5EPtx2rMzu5TjQSyXHUZbpghCk_JcNa2gimayKLYLi4JP-hw/exec`
- `docs/config.js` wired to the web-app URL and pushed.

## What's left

### 1. Fill the Sheet

**`roster` tab.** Delete the three sample rows. Paste from your local
`config/roster.csv` (kept private, gitignored). The Sheet needs these four
columns — map from your CSV as follows:

| Sheet column | From your `roster.csv` |
|--------------|------------------------|
| `student_id` | `student_id`           |
| `name`       | `label` (e.g. "Pranav A.") or `full_name` |
| `email`      | `email`                |
| `token`      | `token`                |

If you leave `token` blank, run the function `generateMissingTokens` from the
editor to fill in unique tokens.

**`networks` tab.** Edit the seeded rows (advice / friendship / status).
`id` becomes the output filename (`advice.csv`, etc.). `title` and `prompt`
are what students see. Add, remove, or reword rows freely.

### 2. Set Script Properties

In the Apps Script editor: **gear icon (Project Settings)** → scroll to
**Script Properties** → **Add script property** for each:

| Key              | Value                                                                             |
|------------------|-----------------------------------------------------------------------------------|
| `ADMIN_TOKEN`    | any secret you pick (used to log in to `admin.html`)                              |
| `ADMIN_EMAIL`    | `ben.golub@gmail.com`                                                             |
| `FORM_URL`       | `https://bengolub-economics.github.io/mmss2113-2026-code/form.html`               |
| `GITHUB_OWNER`   | `bengolub-economics`                                                              |
| `GITHUB_REPO`    | `mmss2113-2026-code`                                                              |
| `GITHUB_BRANCH`  | `main`                                                                            |
| `GITHUB_TOKEN`   | a fine-grained PAT (see below)                                                    |

### 3. Create the GitHub PAT

GitHub → Settings → Developer settings → **Personal access tokens** →
**Fine-grained tokens** → **Generate new token**.

- Resource owner: `bengolub-economics`
- Repository access: **Only select repositories** → `mmss2113-2026-code`
- Permissions → Repository permissions → **Contents: Read and write**
  (leave everything else at No access)
- Expiration: end-of-semester is fine.

Copy the token, paste it into the `GITHUB_TOKEN` script property.

### 4. Smoke test before emailing the class

1. Grab any token from the `roster` tab.
2. Open
   `https://bengolub-economics.github.io/mmss2113-2026-code/form.html?token=<that-token>`.
3. You should see your classmates listed for all three networks. Fill one
   out so it sums to 100; click Save; confirm you see `Saved (1/NN total)`.
4. Open
   `https://bengolub-economics.github.io/mmss2113-2026-code/admin.html`,
   paste your `ADMIN_TOKEN`, and confirm the completion counts show up.

### 5. Email the class

In the Apps Script editor, pick `sendLinks` from the function dropdown and
**Run**. Each student gets their personal `form.html?token=…` link.

Re-running is safe — it just re-emails.

### 6. Release

- **Auto:** when the last student submits, the backend builds the CSVs,
  commits them to `docs/data/` via the GitHub API, and emails
  `ADMIN_EMAIL`.
- **Manual early release:** from `admin.html`, click **Force-publish now**.

The public CSVs will be at:

- `https://bengolub-economics.github.io/mmss2113-2026-code/data/all_networks.csv`
- `https://bengolub-economics.github.io/mmss2113-2026-code/data/<network_id>.csv`

## CSV schema

```
network,source_id,source_name,target_id,target_name,weight
advice,s001,Pranav A.,s002,Shriya B.,40
advice,s001,Pranav A.,s003,Lewis B.,60
...
```

`source_name` / `target_name` use whatever you put in the Sheet's `name`
column. If you want fully anonymous output, use abstract `student_id`s
(`s001`) as the `name` too, and the `_name` columns won't leak.

## Troubleshooting

- **`ReferenceError` when running `setup`** — incomplete paste of `Code.gs`.
  Re-copy the whole file from the repo and overwrite.
- **Student sees "Invalid token"** — the token in their URL doesn't match
  any row in `roster`. Check for trailing whitespace / accidental edits.
- **`GitHub push failed`** in logs — likely `GITHUB_TOKEN` is missing,
  expired, or lacks Contents: write on this repo. Regenerate and update.
- **Changed `Code.gs` and nothing happened** — you must redeploy. Use
  **Deploy → Manage deployments → pencil icon → Version: New version →
  Deploy**. The URL stays the same.

## Useful links

- Repo: https://github.com/bengolub-economics/mmss2113-2026-code
- Pages: https://bengolub-economics.github.io/mmss2113-2026-code/
- Admin: https://bengolub-economics.github.io/mmss2113-2026-code/admin.html
- Final CSV (after release):
  https://bengolub-economics.github.io/mmss2113-2026-code/data/all_networks.csv
