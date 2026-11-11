# Injury substitution week rollover repair

- Preserves historical injurySwapHistory and finalized weeklyLedger records.
- Expires stale live scoringMode, scoreAtSwap, credited and pending injury state when those records do not belong to the active NFL week.
- Checks current-week substitution history rather than stale player fields in lineup change, full lineup save, and drop validation.
- Keeps committed same-week substitutions and kickoff locks protected.
- Supports an already-advanced Week 10 database by cleaning stale Week 9 fields during the next scoring sync, not only when the week number changes.
- Tags newly simulated pending injuries with their NFL week.

Regression: node test-injury-swap-week-rollover.js; all test-*.js pass locally.

Deployment: upload complete application and wait for scheduled scoring sync, then refresh My Team. Production database behavior is not yet verified.
