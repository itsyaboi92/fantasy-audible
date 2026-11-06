# Automatic NFL-week matchups

- Matchups are frozen **after draft completion**, never on registration or before the draft.
- ESPN scoreboard provides the current NFL week and earliest scheduled kickoff. If any game has kicked off, the first league matchup is the following NFL week.
- Schedules run through NFL Week 14. An odd number of teams receives a rotating bye.
- Prior NFL weeks are not scored for the new league; the live scoring loop uses ESPN's current NFL week after schedule activation.
- The empty-matchup message now distinguishes pending draft, pending ESPN calendar, missing teams, and weeks before the league start.
- Existing frozen schedules and verified ledgers are retained, not regenerated. Restarting the league intentionally clears the frozen schedule and old ledger.
- If draft completion occurs after the Week 14 scheduling cutoff, the system reports that the regular-season window has ended instead of inventing a schedule.

Deployment: replace server.js and public/app.js. No database migration required. ESPN calendar and live deployment were not integration-tested; syntax checks were run.
