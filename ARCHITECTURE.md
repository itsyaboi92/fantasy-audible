# Fantasy Audible — consolidated architecture

This release retains the existing persistence schema, HTTP endpoints, scoring semantics, and browser bundle. It **does not** introduce a second scoring engine or a parallel injury-lock implementation.

## Runtime ownership

| Module | Sole responsibility |
|---|---|
| `server.js` | HTTP routing, persistence transactions, orchestration, draft, commissioner actions, ESPN synchronization and editorial jobs |
| `league-ledger.js` | Current-week score isolation, frozen lineup snapshots, matchup finalization, standings |
| `injury-substitutions.js` | Week-scoped injury-swap history, pending decisions, expiry of previous-week metadata, replacement eligibility |
| `roster-rules.js` | Kickoff-based roster locks, position eligibility, injured-reserve eligibility |
| `live-nfl.js` | NFL schedule and live game data |
| `espn.js` | ESPN player data adapter |
| `event-ledger.js` | Game event evidence |
| `defense-store.js` / `fantasy-dst-actual.js` | Defensive scoring evidence and scoring adapters |
| `public/app.js` | Existing browser UI; kept intact to avoid an untested module-loading change |

## Non-negotiable invariants

- A Week 9 substitution is immutable in Week 9 but must not lock Week 10.
- Week-specific injury decisions remain irreversible within their own week.
- A final matchup is not recalculated from a later week's roster.
- Upcoming games show zero actual points; projections remain separate.
- Existing league/account state and API responses are not migrated or reset.
- Kickoff locks are checked against the verified NFL schedule.

## Verification

Run `npm test` for syntax checks, followed by `node test-architecture-ownership.js` and the existing `test-*.js` fixture suite. These are **local** checks; live ESPN and Render integration must still be confirmed in a staging environment before production rollout.

## Deferred architectural boundaries

The large `server.js` still owns draft, transactions, synchronization, and editorial workflows; the browser UI remains in `public/app.js`. Splitting those safely requires dependency-injection and browser-loading integration tests, not just moving code. They are deliberately not represented as complete in this release.
