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

## Fire Stick player (Step 2)
The player (`server/public/player/`) is plain HTML/JS. It is served by the server at `/player/` (handy for testing in any browser) and bundled unchanged into the Android app in `android/`.

- First start shows a 6-digit code; enter it in the dashboard under the store's Screens.
- Downloads each playlist's images/videos into on-device storage (IndexedDB), then plays from there. No internet needed to keep playing, including after a restart. It re-syncs every 60 s and only downloads new/changed files.
- Follows the schedule in the store's time zone, evaluated on the device.
- Removing the screen in the dashboard sends the device back to the pairing code.

### Installing on a Fire Stick
1. GitHub → Actions → **Build Fire TV app** → Run workflow (put your server's address in `server_url`, or leave empty and type it on the TV). Download the `menu-player-apk` artifact.
2. On the Fire Stick: Settings → My Fire TV → Developer options → turn on *Install unknown apps* (and ADB debugging).
3. Install the APK, e.g. `adb connect <stick-ip>` then `adb install app-debug.apk`, or with the Downloader app.

The server must be reachable from the Fire Stick (same Wi-Fi works for testing; use a public HTTPS host for real stores).
