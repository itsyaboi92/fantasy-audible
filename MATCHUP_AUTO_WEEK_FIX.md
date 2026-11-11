# Matchup current-week selection repair

- `public/app.js` now defaults Matchup to the current NFL week, bounded below by the league's starting week.
- An explicit week selection remains in effect while reviewing the Matchup tab. Leaving and re-entering Matchup restores the current NFL week.
- When the server updates its current week, the automatic selection follows it and resets the matchup index; previous weeks remain available in the dropdown.
- No backend scoring, finalization, standings, or frozen lineups were modified.
- Run `node test-matchup-auto-week.js` to test week rollover and manual navigation.
