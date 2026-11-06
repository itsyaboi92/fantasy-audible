# Fantasy Audible v36.4 — ESPN Box-Score-Only D/ST

Replace these four files in the root of the existing Fantasy Audible GitHub repository (preserving paths):
- `live-nfl.js`
- `event-ledger.js`
- `server.js`
- `public/app.js`

Do not replace the whole project with this patch ZIP. Existing database and offensive player logic are preserved.

D/ST is now scored through `defenseStats` and `scoreDefense` only, from ESPN box-score player groups and team statistics. The old event-ledger D/ST play parser is no longer called. Generic fumbles `REC` is **not** used as a defensive recovery because it includes a team's own fumble recoveries; only a defensively identified FR or official team defensive recovery is counted. The special-teams fumble-lost scoring option is removed from the settings UI/defaults, and persisted legacy settings have no effect on D/ST scoring.

IMPORTANT: If ESPN omits a D/ST category, it remains unavailable, not zero. Points allowed use the game score and do not subtract opposing defensive/special-teams scores when ESPN does not provide an explicit D/ST points-allowed field. This is a known box-score-only limitation. No live ESPN integration test was run.

Local tests: `node tests/v36-2-dst-boxscore.test.js` and `node tests/v36-4-boxscore-only.test.js`.
