# Fantasy Audible v18 — Player projections and injury-aware auto-draft

- Players now displays next-game estimated PPR points from the same NFL player metadata and historical projection engine as Matchups. This is an estimate, **not an official ESPN weekly projection**. A dash remains when no usable estimate or scheduled game exists.
- The Players tab fetches NFL schedule and metadata for the current NFL week and refreshes after the response arrives. The existing Last game and Live values still come from the weekly scoring directory.
- NFL player metadata now covers the full ESPN player directory, not just players on league rosters, so free agents can receive next-game estimates.
- Auto-draft injury preference recognizes additional ESPN injury-reserve and inactive status variants, and continues to prioritize eligible non-OUT/IR players over injured queue choices. If no eligible alternative exists, it falls back to the injured pool rather than stopping the draft.
- Existing stored data and database schema are unchanged.
