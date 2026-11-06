# v29 — League-week kickoff lock diagnostics

- Validates lineup edits against the league’s NFL week and season, not ESPN’s rolling current week.
- Checks verified UTC kickoff rather than trusting stale game status labels.
- Reports the specific reason for a locked starter, including the kickoff timestamp, season and week, or an existing injury decision.
- If season metadata is inconsistent or schedule verification fails, lineup edits fail closed with an explicit error. No automatic data migration or reset.
- Only server.js changed from v28. Deploy and retry. If a lock remains, the new error message identifies the blocking condition.
