# Fantasy Audible v17 — historical matchup analytics

- Adds `matchup-analytics.js` server-side. Deploy this new file along with `server.js` and `public/app.js`.
- Weighted recent-game projections are **estimates**, not ESPN weekly forecasts. Calculated from available ESPN game box scores using league scoring. At least two completed appearances are required.
- Opponent-position rank uses points conceded by NFL defenses against rostered position groups (QB, RB, WR, TE) over the previous four weeks. Ranks are withheld unless 32 teams have at least two observed games; no fabricated rankings.
- Kicker and D/ST projections are intentionally unavailable pending reliable statistical coverage.
- Latest available ESPN injury designation remains visible. Detailed injury reports are not yet integrated.
- The initial historical-data request may be slow while game summaries are retrieved. Server caches results for one hour.
- No database migration or roster reset.
