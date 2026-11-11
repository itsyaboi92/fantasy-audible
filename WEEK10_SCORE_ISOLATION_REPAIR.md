# Week 10 score isolation and commissioner simulation reset

- `syncNFLScoring` resets transient roster scoring when the NFL week rolls over and stamps `scoreWeek` on calculated points. Finalized weekly ledger entries are not altered.
- Current Matchup tab only displays earned scores stamped for the selected week and only after kickoff; upcoming games always show zero. Frozen ledger entries keep their own historic points.
- Pregame win probability no longer counts stale prior-week player points.
- Commissioner > Simulate points now has a reset action. New simulations store reversible amounts; legacy simulations can only be cleared from transient upcoming-game player scores. It refuses live/final games and never edits frozen historical matchup results.
- Existing finalized Week 9 totals remain immutable. The reset is not an override of historical scores.
