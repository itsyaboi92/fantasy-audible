# Fantasy Audible v24 — The Audible

Changed: `server.js`, `public/app.js`. All other v23 files retained.

- Server publishes and persists edition records in the existing PostgreSQL JSONB state, with deterministic IDs to prevent duplicate editions.
- Eastern Time schedules: Tuesday 9 AM recap (previous week), Thursday 9 AM rankings, Sunday 8 AM preview (current week).
- Recaps include only final verified ledger scores. If no finals are available, no recap is published. Rankings require at least one verified result; previews require scheduled matchups.
- Latest edition appears above Home dashboard cards. Previous editions are expandable on Home. A button opens Locker Room for discussion (it does not create a bot chat message or article-specific thread).
- Commentary is rule-based templates, not AI-generated. No extra paid API or database migration is needed.
- This v23 codebase currently has a single global league state; genuine multiple-league isolation is not yet implemented. Do not assume v24 provides separate multi-league coverage.
- Caveat: If the server's week counter does not advance before Tuesday morning, a previous-week recap may be delayed or target the wrong week. Confirm league week rollover and ledger finals before production use.
- Deployment requires live testing on Render; syntax checks are not integration tests.
