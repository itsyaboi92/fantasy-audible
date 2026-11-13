# Phase 1: Safe modularization

- Extracted `updateWeeklyLedger` and `leagueStandings` into `league-ledger.js`, preserving the existing APIs, persistent record shape, and final-result immutability.
- Retained `currentWeekScore`, `ledgerScore`, `ledgerLineup`, and `ledgerTotal` in `server.js` for now because existing tests and other code rely on them. The new ledger module receives those helpers explicitly.
- Archived version-specific release notes under `docs/history/` without deleting them.
- No database migrations, route changes, scoring rule changes, or UI behavior changes.
- Next phase: consolidate week lifecycle and injury locks with integration tests, then UI modules.
