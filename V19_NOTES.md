# Fantasy Audible v19

Commissioner-only draft order controls added to the Draft and Commissioner tabs. Before the draft starts, move registered teams up/down or randomize the entire order. Changes persist in server state and are validated against all registered accounts. Draft start uses this sequence to generate a snake draft; after starting, the sequence is locked. If registered membership changes before the draft, the order falls back to the current registered team list until a new order is saved.

To update v18, replace only `server.js` and `public/app.js` in GitHub. No schema migration is required.
