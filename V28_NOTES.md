# v28 — verified kickoff lineup lock fix

The server now fetches the authoritative NFL calendar and current-week game schedule for each lineup save or assignment, before entering the database transaction. This fixes false locks when nflSync is absent, delayed, or tied to a previous week. Real kickoffs and live/final games remain locked; bye-week players are movable when a complete weekly schedule is available. If ESPN is unreachable or returns an incomplete schedule, the edit returns HTTP 503 rather than permitting unsafe substitutions.

Replace server.js and public/app.js. No database migration, no roster reset.
