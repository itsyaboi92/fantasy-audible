# Fantasy Audible v36.0 — Defensive source reconciliation foundation

Full project package assembled from v35 Event Engine Development with v35.3, v35.5, v35.6, and v35.7 files layered in release order, then v36 changes. The v35.4 fumble attribution fix is already present in the v35.6 event-ledger.js.

## Changes
- Defensive player box-score parsing now maps each ESPN column label to its corresponding athlete value by position.
- Handles common sacks, interception, forced-fumble, fumble-recovery, safety, and blocked-kick aliases in defensive and fumble groups.
- Preserves official zeroes and never overrides a box-score total with a partial play-by-play count.
- Conflicting aggregate groups are unresolved rather than using an arbitrary maximum.
- Kickoff/punt recovery can resolve a recovering player's team through the ESPN game box-score roster.
- Removes the dangerous inference that `at BAL 18` means Baltimore recovered the fumble.
- Regression tests cover ESPN column mapping, contradictory groups, partial-play precedence, and kickoff recovery ownership.

## Important limitations
- Not a fully verified 32-team, nine-week historical scoring audit. No live 2026 ESPN response was available in this execution environment.
- Rare conversion returns, one-point safeties, blocked-kick TDs, and D/ST points-allowed exclusions still need raw-game regression fixtures before being considered automatically verified.
- Existing league database and settings are not reset. Historical scores refresh only through the application's existing synchronization process; no bulk backfill job was added.
- This is a full project ZIP; deploy by replacing the project files while preserving secrets, environment variables and your persistent database. Keep a backup of the current deployment.
