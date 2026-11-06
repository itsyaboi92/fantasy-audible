# v22 Live injury push notifications

Replace `server.js`, `public/app.js`, and `package.json`; add `public/sw.js`. Run `npm install` on deployment.

Configure VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (a valid mailto: address) on Render. Generate keys with `npx web-push generate-vapid-keys`. Use HTTPS and install the site as an iPhone Home Screen app (iOS 16.4+).

The server checks ESPN injury designations approximately every 2 minutes during active NFL games. It only opens a decision when it observes a new transition from a non-injured designation to Q/D/OUT/IR, and finds an eligible bench replacement. No automatic substitution occurs. Initial observations are baselines, not injury events. ESPN may lag, omit, or use inconsistent designations.

**Important limitations:** Reminder notifications are attempted within 10 minutes of the earliest upcoming same-position bench replacement kickoff. Delivery is best effort. The release also does not correct the preexisting scoring engine's provisional injury-substitution accounting. ESPN injury statuses and live-game mappings must be tested with real games before relying on alerts.
