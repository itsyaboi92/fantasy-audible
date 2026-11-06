# Fantasy Audible v34 — Play event integration (incremental)

Changes: collect/deduplicate ESPN play records, parse field-goal distances in `Yd` and `yard` formats, attribute kickers by athlete ID or matching name, use play-derived defensive team event counts when identifiable, and preserve existing server state and injury-substitution guards.

**Not a complete event-sourced engine:** passing/rushing/receiving and several D/ST categories still use aggregate boxscore values; boxscore counts still provide minimum field-goal fallbacks. No full event ledger persistence or postgame reconciliation has been implemented. Missing play data is explicitly provisional. Do not rely on this version for final money-league scoring without validating it.

Replace `live-nfl.js` and `server.js`; do not reset PostgreSQL. Check Cam Little's distances and D/ST totals after deployment.
