# v32 — Made field-goal baseline scoring

Fixes an undercount in both the player game-statistics modal and the weekly matchup sync. Previously, made field goals with no verified per-kick distance were worth zero. Now the shared `live-nfl.js` scorer credits each verified made field goal at the minimum configured made-FG bucket, while retaining a visible warning that exact distance bonuses remain unverified. When a verified distance event is passed to the scorer, that kick uses its exact configured bucket and is not double-counted.

For example, four made FGs and three PATs are worth at least 15 points with the default 3/4/5/6 FG and 1 PAT settings. This is still provisional and may be an underestimate until exact distances are available. This release does not claim to resolve defensive touchdown attribution or play-by-play bonus validation.

Replace `live-nfl.js` and `server.js` from this archive, then redeploy. Existing PostgreSQL league data is unchanged. The existing scheduled NFL scoring sync will recalculate scores for its active week; historical completed weeks are not automatically backfilled by this release.
