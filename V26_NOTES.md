# Fantasy Audible v26 — The Audible Locker Room bot

Based on uploaded v25. Replace `server.js` and `public/app.js` in GitHub.

- Posts published Tuesday recaps, Wednesday rankings, Thursday previews and Sunday outlooks to Locker Room, in addition to Home editions.
- Posts verified final matchup results with blowout / nail-biter commentary; never claims provisional scores are final.
- Reacts to new draft completion, autopicks, injury substitutions, team renames, waiver wins and free-agent pickups.
- Bot has its own identity (🎙️ The Audible), with commissioner moderation available.
- Database-backed `(league_id,event_key)` unique constraint makes posting idempotent across process restarts and concurrent workers.
- Transaction event cursor prevents historical transaction spam on initial deployment; previously published Home articles are posted to chat once.
- Chat messages and bot events are namespaced with `league_id`, default `default`. **Important:** v25 authentication and state still support only ONE league; this release does not introduce full multi-league accounts or independent state. Future multi-league routing must validate league membership server-side and scope all other league data.
- Existing accounts, rosters, chat, draft, and stored articles are preserved. Schema changes are additive.

Tests: `npm test` checks server and browser JavaScript syntax. A real PostgreSQL deployment test is still required.
