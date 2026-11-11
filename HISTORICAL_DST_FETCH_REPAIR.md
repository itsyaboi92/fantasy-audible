# Historical D/ST final-game retrieval repair

## Confirmed root cause
`reconcileHistoricalMatchups()` excluded `c.pos === 'D/ST'` when constructing the set of final games to fetch. As a result, a game referenced only by a D/ST lineup entry was not fetched and its final box-score defensive statistics were not ingested by this reconciliation path.

## Implemented
- Include D/ST starters in the unique final-game fetch list.
- Retain one fetch per game, even when multiple starters reference it.
- Continue to ingest the final ESPN box score through `defenseStore.ingest` before retrieving the verified defensive score.
- Preserve strict verification, frozen lineups, injury substitution behavior, and the existing 30-minute historical reconciliation scheduler.
- Added `test-historical-dst-fetch.js` regression test.

## Validation
Eight `test-*.js` scripts passed locally, plus syntax checks and ZIP integrity.

## Not yet resolved
The supplied Week 9 diagnostic reports absent D/ST fields (safeties, blocked kicks, return scores, etc.) and five incomplete defenses. This repair improves final-game evidence ingestion but does not assert that ESPN's final box score contains all these fields. Missing fields are NOT converted to verified zeros. The five defenses and three blocked matchups require a fresh diagnostic after deployment. An additional source-backed zero-verification implementation may still be needed.

## Deployment
Upload this complete ZIP to your repository as you normally do, deploy Render, wait for the existing historical reconciliation job, and export a new Week 9 diagnostic. Check `score.complete`, `score.unsupported`, and `matchups[].status`.
