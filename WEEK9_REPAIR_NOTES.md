# Week 9 integrated reconciliation repair
Source: user-provided fantasy-audible-main 7.zip.

## Confirmed logic defects corrected
- A later-kickoff injury replacement was permanently excluded from historical verification and then categorically prevented from finalization.
- Historical scoring relied on today's player owner/scoringMode even when a frozen lineup was available.
- The live scorer categorically skipped later-kickoff replacements.
- The live ledger's verification predicate permitted zero-point upcoming entries to be treated as verified.
- Persisted D/ST `complete` previously ignored individual stat verification flags and final-game evidence.
- Week 9 commissioner report now includes PostgreSQL defensive category evidence and conflicts (v3).

## Safeguards
- Handcuff replacements remain provisional until a correct event-time credit calculation is implemented.
- Later-kickoff replacement requires a matching persisted swap history record.
- No scores are manufactured and missing defensive categories remain unverified.
- Historical finalized matchups remain immutable.
- Missing player team IDs and unsupported ESPN feeds still block finalization.
- No database migration or manual SQL writes.

## Verification
- `npm test`, 5 existing fixture suites, and `test-week9-reconciliation.js` pass.
- No live PostgreSQL or ESPN integration test performed.
- Do not expect all Week 9 blockers to clear. The v3 diagnostic identifies missing/contested D/ST rows.

## Bye-week reconciliation extension
- Historical reconciliation treats a known NFL team absent from a fully final weekly schedule as a bye, assigning 0 and `liveScoreStatus: BYE` with `byeVerified: true`.
- Diagnostic marks these historical entries verified.
- An unknown NFL team ID (such as the current Harrison Mevis snapshot) is NOT automatically marked bye.
- Existing injury-substitution rules remain unchanged; the bye branch does not apply to replacement modes.
- Regression test covers a bye entry and confirms a zero-point final score.
- Limitation: This does not yet provide a canonical complete NFL team-week calendar independent of ESPN's returned game list. If ESPN omits an actual game, bye classification could be wrong; verify schedule completeness before production finalization.
