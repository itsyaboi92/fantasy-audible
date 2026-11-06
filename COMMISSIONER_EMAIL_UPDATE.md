# Commissioner registered emails

Based on the **Priority 1 scoring beta** project ZIP, retaining its live ESPN scoring and D/ST changes.

Replace only `server.js` and `public/app.js` in GitHub. Leave `live-nfl.js`, `espn.js`, `package.json`, and `public/index.html` unchanged. Redeploy Render; no league reset is required.

The Commissioner → League Members section displays the registered email of each claimed manager, or “Not provided” if none is associated with that team. Only authenticated commissioner API state and SSE updates include the registeredEmail property; normal managers do not receive it.

This is a source-level update. JavaScript syntax validated; not tested on the live Render service.
