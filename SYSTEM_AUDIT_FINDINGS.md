# Fantasy Audible — Week 9 system audit (11 Nov 2026)

## Verified from production diagnostic v3
- 3 matchups provisional; 8 unresolved entries: five D/ST with final games but incomplete category verification, plus Steelers D/ST, DK Metcalf and Harrison Mevis without verified scores.
- DK Metcalf and Steelers D/ST have stored team ID 23; Harrison Mevis has no team ID in the frozen lineup. The code cannot safely mark Harrison Mevis as on bye without historical team evidence.
- D/ST rows contain final verified sacks, PA, YA and some turnovers, but omit explicit zero evidence for multiple rare categories. Inferred zeros must not be presented as verified.
- DB conflict records are primarily successive in-game values, not necessarily defects.

## Confirmed source-level defects repaired
1. Live scoring rebuilt completed-week provisional frozen snapshots from current rosters. The updated code retains existing snapshots once all games are final; historical reconciliation owns the final scores.
2. The previous bye fix treated any missing scoreboard game as a bye. Updated logic checks an independent 17-game team schedule and refuses to infer a bye from incomplete schedules.
3. Bye resolution is now separately testable; unknown team affiliations remain unresolved instead of being given a fabricated zero.

## Outstanding issues not claimed fixed
- ESPN summary/boxscore does not explicitly verify all rare D/ST categories. No finalization override or unsupported zero defaults were added. Need independent final-game evidence or complete verified category feed.
- Harrison Mevis frozen entry lacks team ID. Resolve using an authoritative historical athlete-team record before certifying zero.
- Existing tests are unit/regression checks with mocks, not full production PostgreSQL replays.
- Current-week pre-kickoff roster moves and in-game substitution snapshot updates require separate scenario replay before freezing in-progress lineups; this patch preserves current-week behavior until all games final.

## Post-deployment validation
- Verify Steelers D/ST and DK Metcalf become BYE only if independent schedule is complete and historical reconciliation executes.
- Verify Harrison Mevis remains unresolved pending team identity.
- Verify D/ST remains PARTIAL until every required scoring category is verified.
- Check Render logs for `Historical bye verification` errors and `Historical matchup pending` lines.
