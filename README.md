# Fantasy Audible — NFL live scoring integration (provisional beta)

Copy `server.js` and `live-nfl.js` to repository root and `public/app.js` to public/. Retain existing `espn.js`, package.json and database. Set `NFL_SEASON=2026` on Render if needed.

The server polls the ESPN site scoreboard every 60 seconds and requests game summaries for games in progress or final. It matches boxscore athlete IDs to drafted ESPN fantasy IDs, stores per-player game state and provisional points in the existing PostgreSQL JSONB league state, and pushes SSE updates. Matchup displays sync time and incomplete coverage warning.

**Important: This is NOT a production-complete scoring engine.** The unofficial ESPN feeds were not reachable from this build environment; live payload validation and end-to-end testing are pending. Passing/rushing/receiving aggregate points can update, but 40+ yard TD bonuses, field-goal distance scoring, D/ST scoring, fumbles, returns, and injury substitution accounting are NOT implemented or verified. Kicker scores with field goals and D/ST scores are intentionally not overwritten. Do not use provisional scores to settle official matchups. The existing hard-coded demo matchup opponent logic also remains unchanged.

A licensed feed with reliable per-play scoring and stable athlete/team IDs is recommended for production. The schedule/waiver engine elsewhere in server.js remains as before; this feature does not automatically migrate its game status handling.
