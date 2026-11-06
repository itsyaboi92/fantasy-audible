# Fantasy Audible v20 — My Team matchup analytics

- My Team starting lineup selections now show next NFL opponent, kickoff, projected weekly PPR, opponent positional rank (OPRK), and matchup difficulty.
- Bench and IR roster entries show the same metadata; live weekly scoring is shown when available.
- My Team fetches the same NFL matchup and player metadata endpoints used by Matchups, without changing server-side roster/draft/scoring behavior.
- OPRK bands: 1–10 Difficult, 11–22 Average, 23–32 Easy; unavailable rankings display Unrated.
- No database migration required. Browser/live integration verification recommended after deployment.
