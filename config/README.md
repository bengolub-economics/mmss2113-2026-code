# config/

Private configuration. **`roster.csv` is gitignored** — it contains student
emails, NetIDs, and auth tokens and must not be committed to a public repo.

Keep `roster.csv` locally and paste its contents into the `roster` tab of the
Google Sheet during setup (see `apps-script/DEPLOY.md`). The Sheet needs four
columns: `student_id`, `name`, `email`, `token`.

Your existing `roster.csv` has extra columns (`label`, `full_name`, `netid`).
Map them to the Sheet's columns like this:

| Sheet column   | from `roster.csv`        |
|----------------|--------------------------|
| `student_id`   | `student_id`             |
| `name`         | `label` (or `full_name`) |
| `email`        | `email`                  |
| `token`        | `token`                  |

`roster.csv.example` shows the expected format with fake data.
