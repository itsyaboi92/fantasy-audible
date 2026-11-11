# Automatic weekly D/ST finalization repair

Historical reconciliation runs on startup (90 seconds) and every 30 minutes. For a final NFL game, if the D/ST has a persisted score result and the frozen matchup lineup already has a finite PARTIAL point total, reconciliation preserves that exact frozen score and marks the lineup entry UPDATED. It records `finalScoreSource=FROZEN_DST_SNAPSHOT`, `finalScoreGameId`, and `finalScoreConfirmedAt` for traceability. The regular matchup gate then finalizes when all other lineup entries are verified. Standings derive from finalized matchups. Final matchups remain immutable.

This deliberately does not infer zeros for missing D/ST statistical categories, alter scoring formulas, replace a frozen lineup, or bypass verification for offensive players. It also does not finalize if an NFL game is unfinished or the D/ST result is absent. No live production database was accessed; deploy and rerun Week 9 diagnostics to verify real-world finalization.
