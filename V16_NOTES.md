# Fantasy Audible v16 — Verified player identity and injury metadata

- Resolves rostered players by ESPN athlete ID against the latest fantasy directory.
- Uses updated ESPN proTeamId for NFL game mapping, preventing stale team assignments.
- Displays latest available injury designations; UNKNOWN remains unlabeled.
- Keeps existing matchups, scoring, league database and weekly lineup protections.
- Explicitly leaves OPRK and weekly projections blank until a validated, scoring-compatible source is integrated. Season projections are not weekly projections.
- Endpoint: GET /api/nfl/player-metadata?season=2026&week=9 (authenticated).

Replace server.js and public/app.js; redeploy. No database reset.
