# Tenor GIF picker (v7)

Set `TENOR_API_KEY` in Render Environment using a valid Google Tenor API v2 key with Tenor API access enabled. Redeploy. The key is used only by the server and is never sent to browsers. Without the key, the GIF picker displays a configuration message; regular chat, uploaded GIFs and GIF links continue working.

The GIF button opens a Tenor search/featured picker. Choosing a GIF posts its Tenor media URL through the existing authenticated league chat endpoint. The animation is hosted by Tenor and does not consume PostgreSQL GIF-media storage. Provider availability and licensing apply.

The working v4 focus fix is retained: background polling does not redraw the composer while focused. The Tenor picker uses DOM updates to its own results container.

Security: the server validates returned Tenor HTTPS media hosts and limits result count. The Tenor key must not be pasted into public/app.js or committed to GitHub.
