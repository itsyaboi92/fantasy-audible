# v30 — Chained injury substitutions

- A replacement who independently suffers a qualifying in-game injury can be substituted again when another eligible bench player exists.
- Every committed swap is stored in `injurySwapHistory` in league state, with NFL week, manager, injury event, outgoing/incoming players, slot, scoring mode, forfeited score, and timestamp.
- Any removed player cannot return during that NFL week, including via lineup save, individual lineup assignment, or another injury substitution.
- Prior starter points are not carried forward. Only the currently active player scores for the lineup slot.
- No database migration. Existing historical substitutions made before v30 cannot be reconstructed if they were not recorded; older committed locks remain protected by existing scoringMode checks.
- Demo injury actions still mutate live state: test in a nonproduction league or add a separate sandbox in a future version.
