# Digital Menu

Manage digital signage for many stores on Amazon Fire Sticks. Upload images/videos per store, build playlists, schedule them, and assign them to screens (max 10 per store). Each store's content is isolated; managers only see their own stores.

## Run
```
npm install
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=change-me-now SESSION_SECRET=$(openssl rand -hex 32) npm start
```
Open http://localhost:3000. Requires Node 22.5+. Data (SQLite + uploads) lives in `./data` (`DATA_DIR` to change).
Set `SESSION_SECRET` in production so logins survive restarts. Put it behind HTTPS.

## Player API (used by the Fire Stick app, Step 2)
- `POST /api/player/register` → `{code, token}`; show `code` on the TV, keep `token`.
- `GET /api/player/manifest` (Bearer token) → paired state, default playlist, schedule rules (minutes since midnight, store timezone) and every playlist with media URLs. The app downloads everything once and evaluates the schedule locally, so it works offline and after restarts.
- `GET /api/player/media/:file` (Bearer token) → file download, Range supported.

Playlists carry a `version`; the app re-downloads only what changed.

## Test
`npm test`
