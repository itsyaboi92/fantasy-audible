# v33 — ESPN play-level reconciliation foundation

- ESPN scoring plays and drive plays are deduplicated by play ID.
- Explicitly attributed, distance-verified field-goal attempts can replace the minimum FG award with the correct distance bracket.
- Game-specific player detail, player history, active-week sync, and directory scoring use the same play-event adapter.
- Ordinary yards, catches, and touchdowns continue to use ESPN's box-score totals, avoiding double counting.
- Unattributed plays, incomplete play-by-play, long TD bonuses, return TDs, and full D/ST event attribution remain unverified. This is NOT a complete play-by-play scoring engine.
- No database migration or reset.
