# config/

Private configuration. **`roster.csv` is gitignored** — it contains student
emails, NetIDs, and auth tokens and must not be committed to a public repo.

Keep `roster.csv` locally and paste its contents into the `roster` tab of the
Google Sheet during setup (see `apps-script/DEPLOY.md`). The Sheet's `roster`
tab has five columns, in this order:

| # | Sheet column | Notes                                                   |
|---|--------------|---------------------------------------------------------|
| A | `student_id` | stable id used in CSV output (e.g. `s001`)              |
| B | `label`      | short display name shown to students (e.g. `Pranav A.`) |
| C | `full_name`  | formal name kept for records; not shown in UI           |
| D | `email`      | used by `sendLinks()`                                   |
| E | `token`      | auth token in the student's link; leave blank to auto-fill via `generateMissingTokens()` |

`roster.csv.example` shows the expected format with fake data. Your local
`roster.csv` may have additional columns (e.g. `netid`) — only the five
above matter to the backend.
