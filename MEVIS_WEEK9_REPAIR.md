# 2026 Week 9 — Harrison Mevis historical scoring repair

## Verified source evidence
NFL reported that the Rams released kicker Harrison Mevis on October 13, 2026 and replaced him with Blake Grupe:
https://www.nfl.com/news/rams-releasing-kicker-harrison-mevis-signing-k-blake-grupe-off-jets-practice-squad
ESPN player ID 4574716; Rams NFL team ID 14.

## Root cause
A historical frozen Week 9 starter had no NFL team ID, no box-score participation and no verified scoring state. The previous historical reconciliation could not distinguish an inactive released player from a missing feed. It also could not safely borrow the replacement Rams kicker's stats.

## Repair
* New `historical-player-status.js` holds narrowly scoped, source-linked historical exceptions.
* Historical reconciliation resolves the missing Rams team ID and certifies zero points with `INACTIVE` and `inactiveVerified=true` only for Mevis in 2026 Week 9.
* Historical verification and diagnostic endpoint recognize this explicit inactive state.
* Does not assign Mevis the kicking production of Blake Grupe.
* Does not infer inactivity for any other athlete or any other week.

## Tests
`npm test` and all seven `test-*.js` scripts passed. `test-week9-reconciliation.js` includes a released-player regression that asserts no scoring call, zero points, Rams team ID and successful finalization when all other entries are verified.

## Outstanding
Five D/ST units still have unverified critical categories in the latest production diagnostic. This patch does not invent zeroes or finalize those matchups. Deployment and production verification remain necessary.
