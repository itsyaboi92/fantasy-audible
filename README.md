# Fantasy Audible — multiplayer MVP

Run with Node.js 18+ (no packages required):

```bash
node server.js
```

Open http://localhost:3000. For other devices on the same Wi-Fi, use `http://YOUR_COMPUTER_LAN_IP:3000`. To make it accessible across the internet, deploy this Node.js server to a hosting service with persistent storage and HTTPS.

## Included
- Eight navigable app screens
- Shared persistent JSON league state
- Server-sent events that broadcast roster/scoring updates to every open client
- Server-side injury substitution validation
- Same-team handcuffs (score earned before substitution is zeroed)
- Later-kickoff bench replacements (full score)
- Keep-injured-starter option, irreversible transaction history
- Demo commissioner controls for injuries, points, and kickoff windows

## Not production ready
- Demo data only; no real NFL feed or injury verification
- No authentication or authorization: the manager selector is for testing and commissioner controls are public
- No live draft, waivers, trades, league invites, payment system, or playoffs engine
- JSON persistence is suitable for local demonstration, not a scalable database
- For production, use PostgreSQL, authenticated accounts, durable transaction locking, real sports data and authoritative per-play scoring.
