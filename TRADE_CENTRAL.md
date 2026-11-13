# Fantasy Audible Trade Central

Trade Central is located in the League tab. Managers can inspect starters and bench players, view the existing player-history profile, compare available weekly projections and estimate lineup impact before sending offers.

## Voting

- A trade requires acceptance by the receiving manager.
- On acceptance, active claimed teams are counted and the two trading teams are excluded.
- Eligible voters are frozen at acceptance; each eligible team gets one vote.
- Veto threshold is `floor(eligible voters / 2) + 1`.
- The voting window is 24 hours. A threshold-reaching veto immediately rejects the trade; otherwise it processes after the deadline.
- The original offered player IDs are revalidated before acceptance and again at processing.
- The 24-hour clock and electorate are persisted in the existing PostgreSQL JSONB league state, not held in memory.
- The trade deadline worker runs every minute, and the trades endpoint also processes overdue votes.

## Safeguards

- Traded players are transferred to the receiving team's bench, never directly into a locked lineup.
- A trade fails if a player changed owners, a current-week injury substitution applies, an active injury decision is pending, kickoff has passed, or roster/position limits would be exceeded.
- An unavailable verified schedule fails closed. Processing is retried when the schedule becomes available.
- A player with an unavailable weekly projection is excluded from the advisory estimate; missing data is not represented as a verified zero.
- Existing finalized matchup ledgers and historical points are not changed.
- This release uses the existing single-league database model; it does not add the previously discussed multi-league account system.

## API

- `GET /api/trades`
- `POST /api/trades` `{to,give,receive}`
- `POST /api/trades/:id/accept`
- `POST /api/trades/:id/decline`
- `POST /api/trades/:id/withdraw`
- `POST /api/trades/:id/counter` `{give,receive}`
- `POST /api/trades/:id/vote` `{veto:boolean}`

## Testing

Run `node test-trade-central.js` and the existing regression tests. Staging deployment and live NFL feed integration remain unverified.

### Trade Central scoring display repair
- Roster records may have IDs such as `espn-123`; projection and weekly scoring feeds are keyed by the normalized ESPN ID (`123`). Trade Central now resolves the ESPN ID consistently.
- Opening League requests NFL matchup/player metadata, and League rerenders when that request completes.
- `Last` displays the current game's points only if final; otherwise it displays the most recent verified completed-game score from the historical analytics feed. Unavailable scores and projections remain em dashes, never fabricated zeros.
- Starters, bench, and injured reserve are separated in the trade selection UI.
- Regression: `node test-trade-central-scoring.js`.
