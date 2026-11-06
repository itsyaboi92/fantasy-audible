# v31 — Live matchup player statistics

Tap a player name in Matchups to open the selected NFL week’s ESPN game boxscore. The panel shows position-specific raw game statistics, a provisional fantasy scoring breakdown based on league settings, game status, opponent, score and kickoff. During live games it refreshes approximately every 25 seconds while open and visible. Server caches ESPN game summaries for 20 seconds during live games.

Files changed: `server.js`, `public/app.js`, `public/index.html`. No schema migration, no database reset, and no push notification changes.

Limitations: ESPN’s unofficial API can omit player statistics and some scoring categories; the panel clearly marks totals provisional. Does not modify injury substitutions or the weekly scoring ledger.
