import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-'));
const { createApp } = await import('../app.js');
const { db } = await import('../db.js');
const { hashPassword } = await import('../auth.js');

const mk = (email, role) => { const { salt, hash } = hashPassword('password123'); db.prepare('INSERT INTO users(email,pass_hash,salt,role) VALUES(?,?,?,?)').run(email, hash, salt, role); };
mk('admin@x.com', 'admin'); mk('mgr@x.com', 'manager');

const server = createApp().listen(0);
const base = `http://localhost:${server.address().port}`;
test.after(() => server.close());

async function call(method, url, { body, cookie, token, form } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const r = await fetch(base + url, { method, headers, body: form || (body && JSON.stringify(body)) });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, data: ct.includes('json') ? await r.json() : await r.arrayBuffer(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
const login = async (email) => (await call('POST', '/api/login', { body: { email, password: 'password123' } })).cookie;

test('full flow: stores, isolation, upload, playlist, pairing, manifest, 10-screen cap', async () => {
  const admin = await login('admin@x.com');
  const a = (await call('POST', '/api/stores', { cookie: admin, body: { name: 'A' } })).data;
  const b = (await call('POST', '/api/stores', { cookie: admin, body: { name: 'B' } })).data;
  const mgr = (await call('POST', '/api/users', { cookie: admin, body: { email: 'm2@x.com', password: 'password123', stores: [a.id] } }));
  assert.equal(mgr.status, 201);
  const m = await login('m2@x.com');

  assert.equal((await call('GET', '/api/stores', { cookie: m })).data.length, 1);
  assert.equal((await call('GET', `/api/stores/${b.id}/media`, { cookie: m })).status, 403);
  assert.equal((await call('POST', '/api/stores', { cookie: m, body: { name: 'x' } })).status, 403);
  assert.equal((await call('GET', '/api/stores')).status, 401);

  const form = new FormData();
  form.append('files', new Blob([Buffer.from('fakepng')], { type: 'image/png' }), 'menu.png');
  const up = await call('POST', `/api/stores/${a.id}/media`, { cookie: m, form });
  assert.equal(up.status, 201);
  const bad = new FormData(); bad.append('files', new Blob(['x'], { type: 'text/html' }), 'x.html');
  assert.equal((await call('POST', `/api/stores/${a.id}/media`, { cookie: m, form: bad })).status, 400);

  const pl = (await call('POST', `/api/stores/${a.id}/playlists`, { cookie: m, body: { name: 'Lunch' } })).data;
  const put = await call('PUT', `/api/playlists/${pl.id}/items`, { cookie: m, body: { items: [{ media_id: up.data[0].id, duration_sec: 8 }] } });
  assert.equal(put.data.items.length, 1);

  const reg = (await call('POST', '/api/player/register', { body: { id: 'abc123def456', model: 'AFTMA08C15', name: "Counter's stick", ip: '10.0.0.5' } })).data;
  assert.equal((await call('GET', '/api/player/manifest', { token: reg.token })).data.paired, false);
  const pair = await call('POST', `/api/stores/${a.id}/screens/pair`, { cookie: m, body: { code: reg.code, name: 'Front' } });
  assert.equal(pair.status, 201);
  assert.equal(pair.data.device_id, 'abc123def456');
  assert.equal(pair.data.device_name, "Counter's stick");
  assert.equal(pair.data.device_model, 'AFTMA08C15');
  await call('PATCH', `/api/screens/${pair.data.id}`, { cookie: m, body: { default_playlist_id: pl.id } });
  await call('PUT', `/api/screens/${pair.data.id}/schedules`, { cookie: m, body: { schedules: [{ playlist_id: pl.id, days: [1, 2], start: '11:00', end: '14:30' }] } });

  const man = (await call('GET', '/api/player/manifest', { token: reg.token })).data;
  assert.equal(man.paired, true);
  assert.equal(man.playlists[0].items[0].duration_sec, 8);
  assert.equal(man.schedules[0].start_min, 660);
  assert.equal((await call('GET', man.playlists[0].items[0].url, { token: reg.token })).status, 200);
  assert.equal((await call('GET', man.playlists[0].items[0].url)).status, 401);

  for (let i = 0; i < 9; i++) {
    const r = (await call('POST', '/api/player/register')).data;
    assert.equal((await call('POST', `/api/stores/${a.id}/screens/pair`, { cookie: m, body: { code: r.code } })).status, 201);
  }
  const extra = (await call('POST', '/api/player/register')).data;
  assert.equal((await call('POST', `/api/stores/${a.id}/screens/pair`, { cookie: m, body: { code: extra.code } })).status, 409);
});
