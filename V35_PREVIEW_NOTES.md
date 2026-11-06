# v35 event-scoring preview (NOT production engine)

This build adds `event-ledger.js` and read-only replay tests. It does **not** replace the existing production scoring path, because offensive play descriptions and team D/ST events are not yet comprehensively attributed or reconciled. Shipping those unverified calculations as authoritative would risk incorrect league scores. v34 live scoring remains unchanged.

Run `node tests/event-ledger.test.js` for synthetic regression checks.
Run `node tests/replay-game.js <ESPN numeric game ID>` to fetch a completed ESPN game and produce a read-only player scoring and discrepancy report. This requires internet access.

Known gaps: complete offense (two-point conversions, fumbles, all TD bonuses), defensive returns, scoring corrections, complete play coverage, and postgame verification. The replay does not modify fantasy league state or database.
