# Fantasy Audible v21 — Max Projected Starting Lineup

My Team now has a **Maximize Projected Points** button. It optimizes the full roster assignment (including FLEX) with dynamic programming using the same weekly historical estimates displayed in matchup analytics. IR and OUT players are excluded as replacements; existing locked starters remain fixed. The preview shows proposed changes, and the user must confirm the preview and separately click **Save Starting Lineup** to persist changes. Existing server-side lineup validation and kickoff locks remain authoritative. Missing weekly estimates are not fabricated.

## GitHub deployment
Replace **public/app.js** only. No server or database migration is needed.

## Validation
JavaScript syntax checked; live ESPN/Render integration not tested.
