import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, UPLOAD_DIR } from './db.js';
import { hashPassword, verifyPassword, makeSession, requireUser, requireAdmin, storeGuard, canAccessStore } from './auth.js';

export const MAX_SCREENS_PER_STORE = 10;
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB || 500) * 1024 * 1024;
const ALLOWED = { 'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'image/gif': 'image',
  'video/mp4': 'video', 'video/webm': 'video', 'video/quicktime': 'video' };

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_r, f, cb) => cb(null, crypto.randomUUID() + path.extname(f.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_r, f, cb) => cb(ALLOWED[f.mimetype] ? null : new Error('unsupported file type'), !!ALLOWED[f.mimetype]),
});

const one = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);
const id = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const wrap = (fn) => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };

const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '') || null;
// Device info sent by the player: { id, model, name, ip }.
const deviceFields = (d) => ({ id: clip(d?.id, 64), model: clip(d?.model, 64), name: clip(d?.name, 80), ip: clip(d?.ip, 64) });

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')));

  // ---------- auth ----------
  app.post('/api/login', wrap((req, res) => {
    const { email, password } = req.body || {};
    const u = one('SELECT * FROM users WHERE email=?', String(email || '').toLowerCase());
    if (!u || !verifyPassword(String(password || ''), u.salt, u.pass_hash)) return res.status(401).json({ error: 'invalid credentials' });
    res.setHeader('Set-Cookie', `sid=${makeSession(u.id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
    res.json({ id: u.id, email: u.email, role: u.role });
  }));
  app.post('/api/logout', (_q, res) => { res.setHeader('Set-Cookie', 'sid=; Max-Age=0; Path=/'); res.json({ ok: true }); });
  app.get('/api/me', requireUser, (req, res) => res.json(req.user));

  // ---------- player API (device token auth) ----------
  const player = express.Router();
  // The Fire TV app loads the player from its own bundle, so allow cross-origin calls with the device token.
  player.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Device-Info');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  const screenAuth = (req, res, next) => {
    const t = (req.headers.authorization || '').replace(/^Bearer /, '');
    const s = t && one('SELECT * FROM screens WHERE token=?', t);
    if (!s) return res.status(401).json({ error: 'bad device token' });
    req.screen = s;
    next();
  };
  // Device asks for a pairing code; shows it on the TV; admin/manager claims it in the dashboard.
  player.post('/register', wrap((req, res) => {
    const d = deviceFields(req.body);
    const deviceId = d.id;
    // A reinstalled device registers again: drop its old, never-paired entry so it doesn't pile up.
    if (deviceId) run('DELETE FROM screens WHERE device_id=? AND store_id IS NULL', deviceId);
    let code;
    do { code = String(crypto.randomInt(0, 1e6)).padStart(6, '0'); } while (one('SELECT 1 FROM screens WHERE pair_code=?', code));
    const token = crypto.randomBytes(24).toString('hex');
    run('INSERT INTO screens(pair_code, token, device_id, device_model, device_name, device_ip, last_ip) VALUES(?,?,?,?,?,?,?)', code, token, deviceId, d.model, d.name, d.ip, req.ip);
    res.json({ code, token });
  }));
  player.get('/manifest', screenAuth, wrap((req, res) => {
    const s = req.screen;
    let info = {};
    try { info = JSON.parse(decodeURIComponent(req.headers['x-device-info'] || '{}')); } catch {}
    const d = deviceFields(info);
    run("UPDATE screens SET last_seen=datetime('now'), last_ip=?, device_name=COALESCE(?,device_name), device_model=COALESCE(?,device_model), device_ip=COALESCE(?,device_ip), device_id=COALESCE(device_id,?) WHERE id=?",
      req.ip, d.name, d.model, d.ip, d.id, s.id);
    if (!s.store_id) return res.json({ paired: false, code: s.pair_code });
    const store = one('SELECT id,name,timezone FROM stores WHERE id=?', s.store_id);
    const schedules = all('SELECT playlist_id,days,start_min,end_min FROM schedules WHERE screen_id=?', s.id);
    const ids = new Set(schedules.map((x) => x.playlist_id));
    if (s.default_playlist_id) ids.add(s.default_playlist_id);
    const playlists = [...ids].map((pid) => {
      const p = one('SELECT id,name,version FROM playlists WHERE id=?', pid);
      const items = all(`SELECT i.position,i.duration_sec,m.id media_id,m.kind,m.mime,m.size,m.file
        FROM playlist_items i JOIN media m ON m.id=i.media_id WHERE i.playlist_id=? ORDER BY i.position`, pid)
        .map(({ file, ...r }) => ({ ...r, url: `/api/player/media/${file}` }));
      return { ...p, items };
    });
    res.json({ paired: true, screen: { id: s.id, name: s.name }, store, defaultPlaylistId: s.default_playlist_id, schedules, playlists });
  }));
  player.get('/media/:file', screenAuth, wrap((req, res) => {
    const m = one('SELECT store_id,mime FROM media WHERE file=?', path.basename(req.params.file));
    if (!m || m.store_id !== req.screen.store_id) return res.status(404).end();
    res.type(m.mime).sendFile(path.join(UPLOAD_DIR, path.basename(req.params.file))); // supports Range for video
  }));
  app.use('/api/player', player);

  // ---------- dashboard API ----------
  const api = express.Router();
  api.use(requireUser);

  api.get('/stores', wrap((req, res) => {
    res.json(req.user.role === 'admin'
      ? all('SELECT * FROM stores ORDER BY name')
      : all('SELECT s.* FROM stores s JOIN user_stores u ON u.store_id=s.id WHERE u.user_id=? ORDER BY s.name', req.user.id));
  }));
  api.post('/stores', requireAdmin, wrap((req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = run('INSERT INTO stores(name,timezone) VALUES(?,?)', name, req.body.timezone || 'UTC');
    res.status(201).json(one('SELECT * FROM stores WHERE id=?', r.lastInsertRowid));
  }));
  api.delete('/stores/:id', requireAdmin, wrap((req, res) => {
    const files = all('SELECT file FROM media WHERE store_id=?', id(req.params.id));
    run('DELETE FROM stores WHERE id=?', id(req.params.id));
    files.forEach((f) => fs.rmSync(path.join(UPLOAD_DIR, f.file), { force: true }));
    res.json({ ok: true });
  }));

  api.get('/users', requireAdmin, wrap((_q, res) => res.json(
    all('SELECT id,email,role FROM users ORDER BY email').map((u) => ({ ...u, stores: all('SELECT store_id FROM user_stores WHERE user_id=?', u.id).map((r) => r.store_id) })))));
  api.post('/users', requireAdmin, wrap((req, res) => {
    const { email, password, role = 'manager', stores = [] } = req.body || {};
    if (!email || !password || String(password).length < 8) return res.status(400).json({ error: 'email and password (8+ chars) required' });
    if (!['admin', 'manager'].includes(role)) return res.status(400).json({ error: 'bad role' });
    const { salt, hash } = hashPassword(String(password));
    try {
      const r = run('INSERT INTO users(email,pass_hash,salt,role) VALUES(?,?,?,?)', String(email).toLowerCase(), hash, salt, role);
      for (const s of stores) run('INSERT OR IGNORE INTO user_stores VALUES(?,?)', r.lastInsertRowid, id(s));
      res.status(201).json({ id: Number(r.lastInsertRowid), email, role });
    } catch { res.status(409).json({ error: 'email already exists' }); }
  }));

  // media
  api.get('/stores/:storeId/media', storeGuard((r) => id(r.params.storeId)), wrap((req, res) =>
    res.json(all('SELECT id,original_name,kind,mime,size,created_at FROM media WHERE store_id=? ORDER BY id DESC', req.storeId))));
  api.post('/stores/:storeId/media', storeGuard((r) => id(r.params.storeId)), (req, res, next) =>
    upload.array('files', 20)(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      try {
        const out = (req.files || []).map((f) => {
          const r = run('INSERT INTO media(store_id,file,original_name,kind,mime,size) VALUES(?,?,?,?,?,?)',
            req.storeId, f.filename, f.originalname, ALLOWED[f.mimetype], f.mimetype, f.size);
          return { id: Number(r.lastInsertRowid), original_name: f.originalname, kind: ALLOWED[f.mimetype] };
        });
        res.status(201).json(out);
      } catch (e) { next(e); }
    }));
  const mediaGuard = storeGuard((r) => one('SELECT store_id FROM media WHERE id=?', id(r.params.id))?.store_id);
  api.get('/media/:id/file', mediaGuard, wrap((req, res) => {
    const m = one('SELECT file,mime FROM media WHERE id=?', id(req.params.id));
    res.type(m.mime).sendFile(path.join(UPLOAD_DIR, m.file));
  }));
  api.delete('/media/:id', mediaGuard, wrap((req, res) => {
    const m = one('SELECT file FROM media WHERE id=?', id(req.params.id));
    const used = all('SELECT DISTINCT playlist_id FROM playlist_items WHERE media_id=?', id(req.params.id));
    run('DELETE FROM media WHERE id=?', id(req.params.id));
    used.forEach((u) => run('UPDATE playlists SET version=version+1 WHERE id=?', u.playlist_id));
    fs.rmSync(path.join(UPLOAD_DIR, m.file), { force: true });
    res.json({ ok: true });
  }));

  // playlists
  const plGuard = storeGuard((r) => one('SELECT store_id FROM playlists WHERE id=?', id(r.params.id))?.store_id);
  const withItems = (p) => ({ ...p, items: all(`SELECT i.id,i.media_id,i.position,i.duration_sec,m.original_name,m.kind
    FROM playlist_items i JOIN media m ON m.id=i.media_id WHERE i.playlist_id=? ORDER BY i.position`, p.id) });
  api.get('/stores/:storeId/playlists', storeGuard((r) => id(r.params.storeId)), wrap((req, res) =>
    res.json(all('SELECT * FROM playlists WHERE store_id=? ORDER BY name', req.storeId).map(withItems))));
  api.post('/stores/:storeId/playlists', storeGuard((r) => id(r.params.storeId)), wrap((req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = run('INSERT INTO playlists(store_id,name) VALUES(?,?)', req.storeId, name);
    res.status(201).json(withItems(one('SELECT * FROM playlists WHERE id=?', r.lastInsertRowid)));
  }));
  // Replace the full ordered item list: [{media_id, duration_sec}]
  api.put('/playlists/:id/items', plGuard, wrap((req, res) => {
    const items = req.body?.items;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
    for (const it of items) {
      const m = one('SELECT store_id FROM media WHERE id=?', id(it.media_id));
      if (!m || m.store_id !== req.storeId) return res.status(400).json({ error: 'media not in this store' });
    }
    db.exec('BEGIN');
    try {
      run('DELETE FROM playlist_items WHERE playlist_id=?', id(req.params.id));
      items.forEach((it, i) => run('INSERT INTO playlist_items(playlist_id,media_id,position,duration_sec) VALUES(?,?,?,?)',
        id(req.params.id), id(it.media_id), i, Math.min(Math.max(Number(it.duration_sec) || 10, 1), 3600)));
      run('UPDATE playlists SET version=version+1 WHERE id=?', id(req.params.id));
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json(withItems(one('SELECT * FROM playlists WHERE id=?', id(req.params.id))));
  }));
  api.delete('/playlists/:id', plGuard, wrap((req, res) => { run('DELETE FROM playlists WHERE id=?', id(req.params.id)); res.json({ ok: true }); }));

  // screens
  const scGuard = storeGuard((r) => one('SELECT store_id FROM screens WHERE id=?', id(r.params.id))?.store_id);
  const screenOut = (s) => ({ id: s.id, name: s.name, store_id: s.store_id, default_playlist_id: s.default_playlist_id, last_seen: s.last_seen,
    device_id: s.device_id, device_model: s.device_model, device_name: s.device_name, device_ip: s.device_ip, last_ip: s.last_ip,
    schedules: all('SELECT id,playlist_id,days,start_min,end_min FROM schedules WHERE screen_id=?', s.id) });
  api.get('/stores/:storeId/screens', storeGuard((r) => id(r.params.storeId)), wrap((req, res) =>
    res.json(all('SELECT * FROM screens WHERE store_id=? ORDER BY id', req.storeId).map(screenOut))));
  // Claim a device by the 6-digit code shown on its TV.
  api.post('/stores/:storeId/screens/pair', storeGuard((r) => id(r.params.storeId)), wrap((req, res) => {
    const count = one('SELECT COUNT(*) c FROM screens WHERE store_id=?', req.storeId).c;
    if (count >= MAX_SCREENS_PER_STORE) return res.status(409).json({ error: `store already has ${MAX_SCREENS_PER_STORE} screens` });
    const s = one('SELECT * FROM screens WHERE pair_code=? AND store_id IS NULL', String(req.body?.code || ''));
    if (!s) return res.status(404).json({ error: 'code not found' });
    run('UPDATE screens SET store_id=?, name=?, pair_code=NULL WHERE id=?', req.storeId, String(req.body?.name || '').trim() || `Screen ${count + 1}`, s.id);
    res.status(201).json(screenOut(one('SELECT * FROM screens WHERE id=?', s.id)));
  }));
  api.patch('/screens/:id', scGuard, wrap((req, res) => {
    const { name, default_playlist_id } = req.body || {};
    if (default_playlist_id != null) {
      const p = one('SELECT store_id FROM playlists WHERE id=?', id(default_playlist_id));
      if (!p || p.store_id !== req.storeId) return res.status(400).json({ error: 'playlist not in this store' });
    }
    if (name !== undefined) run('UPDATE screens SET name=? WHERE id=?', String(name), id(req.params.id));
    if (default_playlist_id !== undefined) run('UPDATE screens SET default_playlist_id=? WHERE id=?', default_playlist_id, id(req.params.id));
    res.json(screenOut(one('SELECT * FROM screens WHERE id=?', id(req.params.id))));
  }));
  api.delete('/screens/:id', scGuard, wrap((req, res) => { run('DELETE FROM screens WHERE id=?', id(req.params.id)); res.json({ ok: true }); }));
  // Replace the schedule: [{playlist_id, days:[0-6], start:"HH:MM", end:"HH:MM"}]
  api.put('/screens/:id/schedules', scGuard, wrap((req, res) => {
    const rules = req.body?.schedules;
    if (!Array.isArray(rules)) return res.status(400).json({ error: 'schedules array required' });
    const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t)); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };
    const rows = [];
    for (const r of rules) {
      const p = one('SELECT store_id FROM playlists WHERE id=?', id(r.playlist_id));
      const a = toMin(r.start), b = toMin(r.end);
      const days = Array.isArray(r.days) ? r.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [0, 1, 2, 3, 4, 5, 6];
      if (!p || p.store_id !== req.storeId || a == null || b == null || !days.length) return res.status(400).json({ error: 'invalid schedule rule' });
      rows.push([id(r.playlist_id), days.join(','), a, b]);
    }
    run('DELETE FROM schedules WHERE screen_id=?', id(req.params.id));
    rows.forEach((r) => run('INSERT INTO schedules(screen_id,playlist_id,days,start_min,end_min) VALUES(?,?,?,?,?)', id(req.params.id), ...r));
    res.json(screenOut(one('SELECT * FROM screens WHERE id=?', id(req.params.id))));
  }));

  app.use('/api', api);
  app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'server error' }); });
  return app;
}
