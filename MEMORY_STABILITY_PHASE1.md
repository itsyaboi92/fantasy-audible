# Memory stability phase 1 (Render 512 MB)

## Changes
- Added `resource-scheduler.js`, a process-local, single-flight gate shared by `syncNFLScoring`, `syncPlayerDirectory`, `reconcileHistoricalMatchups`, and `faSyncRosterStatuses`.
- Existing job intervals remain unchanged. If a heavy job is running, the next heavy tick is skipped and retried at its next scheduled interval; ticks are never queued.
- Each heavy job logs start/end, elapsed milliseconds, RSS, heap, external/array-buffer memory, and RSS delta. `[memory-health]` logs every 60 seconds even when idle.
- Database schema, scoring formulas, player history, trading and API contracts are unchanged.

## Operational notes
- Skipping a job delays its next refresh. This is intentional to prevent simultaneous large allocations; monitor logs for excessive `skipped` counts and stale scoring.
- This is a preventative concurrency and instrumentation change, not a verified cure for the OOMs. Check Render Events and Metrics after deployment.
- `[memory-health]` reports process RSS, not total container memory. A 512 MB instance can still OOM with RSS below 512 MB.
- On Render, search logs for `[resource-job]` and `[memory-health]`; compare timestamps immediately before an OOM.
- If OOM persists, investigate per-game fetch concurrency, historical response buffering, and database-state copies in phase 2.

## Validation
Run `node test-resource-scheduler.js`, `npm test`, and the repository's `test-*.js` scripts. No live Render or ESPN integration test is claimed.
