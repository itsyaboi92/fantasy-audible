# v35 Event scoring integration — development build
This build switches the production scoring sync from box-score aggregate calculations to event-ledger calculations for offensive players, kickers and D/ST. The box score is used for diagnostics only in player scoring. Existing kicker parsing is retained in live-nfl.js; the new event ledger also recognizes kicking events.

IMPORTANT: This build is not feature-complete and is NOT validated against real ESPN play-by-play payloads. The text-based offensive parser may miss or misattribute plays. D/ST yards-allowed scoring is not implemented from events. D/ST points-allowed is presently derived from game scoreboard at final, not event ledger. Return touchdowns and two-point conversions are not fully covered. Incomplete feeds may still yield partial totals. Production scoring is therefore not safe for league use until these issues are resolved.

Injury substitutions: existing scoringMode guard remains in place. It skips updates to substituted players, rather than recalculating injury credit. Finalization requires UPDATED, while partial event scores remain provisional.

Test: node tests/event-ledger.test.js
Rollback: redeploy v34 ZIP files. No database migration in this build.
