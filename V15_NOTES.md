# v15 NFL matchup schedule mapping

- New authenticated GET `/api/nfl/week-matchups?season=2026&week=9` loads ESPN NFL scoreboard data by season/week, mapping each NFL team ID to opponent, home/away, kickoff, game status, and game ID.
- Matchup UI fetches the selected NFL week's metadata and renders NFL opponents and kickoff in the viewer's local timezone.
- Unknown OPRK and weekly projections remain unavailable instead of being invented. Injury status continues to use the existing ESPN player directory, not a dedicated injury refresh.
- No schema migration or database reset.
- Server and frontend JavaScript syntax checks passed. Not tested against deployed Render or live ESPN response in this environment.
