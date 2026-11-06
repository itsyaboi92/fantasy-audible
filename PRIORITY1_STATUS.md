# Priority 1 — scoring-engine audit (incremental beta)

Based on the user's latest full GitHub archive. This update adds a **provisional D/ST box-score scoring path** for verified available sacks, interceptions, forced fumbles, fumble recoveries, safeties, blocked kicks, and opponent points/yards brackets. It reads the existing commissioner scoring settings and does not change the UI or reset league data.

**Not yet complete:** play-by-play attribution for 40+ yard touchdown bonuses, kicker FG distance and misses, defensive/return touchdowns, one/two-point returns, injury substitution settlement, and a verified scoreboard-to-ESPN reconciliation. D/ST points-allowed may differ from fantasy platform rules for defensive scores; treat results as provisional. Do not certify official matchups from this version.

**Deploy:** replace `server.js` and `live-nfl.js` in GitHub. Other files are included unchanged for a complete project archive. Verify the live data before using scores competitively. Syntax checks and synthetic D/ST test passed; no live ESPN/Render integration test was run.
