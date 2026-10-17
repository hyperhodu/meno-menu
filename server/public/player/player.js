// Digital Menu player. Runs in the Fire TV app's WebView (and in any browser for testing).
// Everything needed to play is stored on the device (localStorage + IndexedDB), so playback
// continues with no internet and after restarts. Schedules are evaluated locally.
(() => {
  'use strict';
  const LS = window.localStorage;
  const SYNC_MS = (window.PLAYER_SYNC_SECONDS || 60) * 1000;
  const PAIR_POLL_MS = 5000;
  const $ = (id) => document.getElementById(id);
  const msg = $('msg'), dot = $('dot');

  // ---------- server URL ----------
  // The Android app opens this page with ?server=<url>; remember it on the device.
  try { const q = new URLSearchParams(location.search).get('server'); if (q) LS.setItem('serverUrl', q); } catch {}
  const serverUrl = () => (LS.getItem('serverUrl') || window.PLAYER_SERVER_URL || (location.protocol.startsWith('http') ? location.origin : '')).replace(/\/+$/, '');
  const abs = (u) => (/^https?:/.test(u) ? u : serverUrl() + u);

  // ---------- on-device media store (IndexedDB) ----------
  const dbp = new Promise((res, rej) => {
    const r = indexedDB.open('menu-player', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('media');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => { const d = await dbp; return new Promise((res, rej) => { const t = d.transaction('media', mode); const q = fn(t.objectStore('media')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  const mediaKey = (it) => `${it.media_id}:${it.size}`;
  const getBlob = (k) => tx('readonly', (s) => s.get(k));
  const putBlob = (k, b) => tx('readwrite', (s) => s.put(b, k));
  const allKeys = () => tx('readonly', (s) => s.getAllKeys());
  const delKey = (k) => tx('readwrite', (s) => s.delete(k));

  // ---------- state ----------
  let manifest = null;
  try { manifest = JSON.parse(LS.getItem('manifest') || 'null'); } catch {}
  let token = LS.getItem('token');
  let online = true;
  const setOnline = (v) => { online = v; dot.classList.toggle('off', !v); };

  const show = (html) => { msg.innerHTML = html; msg.classList.add('on'); };
  const hide = () => msg.classList.remove('on');

  async function api(path, opts = {}) {
    const r = await fetch(abs(path), { ...opts, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) } });
    return r;
  }

  // ---------- pairing + sync ----------
  async function register() {
    const r = await fetch(abs('/api/player/register'), { method: 'POST' });
    if (!r.ok) throw new Error('register failed');
    const d = await r.json();
    token = d.token; LS.setItem('token', token); LS.removeItem('manifest'); manifest = null;
  }

  async function downloadMissing(m) {
    const have = new Set(await allKeys());
    const want = new Map();
    m.playlists.forEach((p) => p.items.forEach((it) => want.set(mediaKey(it), it)));
    for (const [k, it] of want) {
      if (have.has(k)) continue;
      try {
        const r = await api(it.url);
        if (!r.ok) continue;
        await putBlob(k, await r.blob());
      } catch { /* try again next sync; keep playing what we have */ }
    }
    for (const k of have) if (!want.has(k)) await delKey(k);
  }

  let syncing = false;
  async function sync() {
    if (syncing || !serverUrl()) return;
    syncing = true;
    try {
      if (!token) await register();
      const r = await api('/api/player/manifest');
      if (r.status === 401) { token = null; LS.removeItem('token'); manifest = null; LS.removeItem('manifest'); setOnline(true); return; }
      if (!r.ok) throw new Error('manifest ' + r.status);
      const m = await r.json();
      setOnline(true);
      if (m.paired) { await downloadMissing(m); LS.setItem('manifest', JSON.stringify(m)); }
      manifest = m;
    } catch { setOnline(false); } finally { syncing = false; }
  }

  // ---------- schedule ----------
  function nowInZone(tz) {
    try {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
      return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), min: +p.hour * 60 + +p.minute };
    } catch { const d = new Date(); return { day: d.getDay(), min: d.getHours() * 60 + d.getMinutes() }; }
  }
  function activePlaylist(m) {
    if (!m || !m.paired) return null;
    const { day, min } = nowInZone(m.store && m.store.timezone);
    const prev = (day + 6) % 7;
    for (const r of m.schedules || []) {
      const days = r.days.split(',').map(Number);
      const wraps = r.end_min <= r.start_min; // e.g. 22:00-02:00
      const hit = wraps ? (days.includes(day) && min >= r.start_min) || (days.includes(prev) && min < r.end_min)
                        : days.includes(day) && min >= r.start_min && min < r.end_min;
      if (hit) return m.playlists.find((p) => p.id === r.playlist_id) || null;
    }
    return m.playlists.find((p) => p.id === m.defaultPlaylistId) || null;
  }

  // ---------- playback ----------
  const layers = { img: [$('a'), $('b')], vid: [$('va'), $('vb')] };
  let flip = 0, curUrl = null, curEl = null;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function playItem(it) {
    const blob = await getBlob(mediaKey(it));
    if (!blob) return false;
    const url = URL.createObjectURL(blob);
    const el = layers[it.kind === 'video' ? 'vid' : 'img'][flip];
    flip ^= 1;
    const done = new Promise((resolve) => {
      if (it.kind === 'video') {
        el.muted = !window.PLAYER_SOUND; el.onended = resolve; el.onerror = () => resolve('error');
        el.src = url; el.play().catch(() => resolve('error'));
      } else { el.onerror = () => resolve('error'); el.onload = () => setTimeout(resolve, Math.max(1, it.duration_sec) * 1000); el.src = url; }
    });
    el.classList.add('on');
    if (curEl && curEl !== el) { const old = curEl, oldUrl = curUrl; old.classList.remove('on'); setTimeout(() => { if (old.pause) old.pause(); old.removeAttribute('src'); URL.revokeObjectURL(oldUrl); }, 800); }
    curEl = el; curUrl = url;
    const res = await Promise.race([done, wait(15 * 60 * 1000)]); // safety cap per item
    return res !== 'error';
  }

  async function run() {
    lock(true);
    let lastKey = '', idx = 0, failures = 0;
    for (;;) {
      if (!manifest || !manifest.paired) {
        if (!serverUrl()) { setup(); await wait(1000); continue; }
        show(manifest && manifest.code ? `<div class="sm">On the dashboard, choose your store and enter this code</div><div class="big">${manifest.code}</div><div class="sm">Waiting to be paired…</div>` : '<div class="sm">Connecting…</div>');
        await sync(); await wait(PAIR_POLL_MS); continue;
      }
      const pl = activePlaylist(manifest);
      if (!pl || !pl.items.length) { show('<div class="sm">No content scheduled right now</div>'); await wait(5000); idx = 0; lastKey = ''; continue; }
      const key = pl.id + ':' + pl.version;
      if (key !== lastKey) { lastKey = key; idx = 0; }
      hide();
      const it = pl.items[idx % pl.items.length]; idx++;
      const ok = await playItem(it);
      failures = ok ? 0 : failures + 1;
      if (failures >= pl.items.length) { show('<div class="sm">Waiting for content to download…</div>'); await wait(5000); failures = 0; }
    }
  }

  const lock = (v) => { try { window.Native && window.Native.setLocked(v); } catch {} };

  function setup() {
    lock(false); // the remote must work to type the server address
    if (document.getElementById('setup')) return;
    show('<div id="setup"><div class="sm">Enter the server address</div><input id="su" placeholder="http://192.168.1.10:3000" autofocus><div class="sm">Press Enter when done</div></div>');
    $('su').addEventListener('keydown', (e) => { if (e.key === 'Enter' && $('su').value.trim()) { LS.setItem('serverUrl', $('su').value.trim()); location.reload(); } });
  }

  // Poll the manifest while paired; the first sync happens immediately.
  setInterval(sync, SYNC_MS);
  sync();
  run();
  window.__player = { sync, get manifest() { return manifest; } };
})();
