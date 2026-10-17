import crypto from 'node:crypto';
import { db } from './db.js';

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

export function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') };
}
export function verifyPassword(pw, salt, hash) {
  const a = Buffer.from(crypto.scryptSync(pw, salt, 64).toString('hex'));
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
export function makeSession(userId) {
  const exp = Date.now() + 7 * 864e5;
  const v = `${userId}.${exp}`;
  return `${v}.${sign(v)}`;
}
function readSession(cookie) {
  const m = /(?:^|;\s*)sid=([^;]+)/.exec(cookie || '');
  if (!m) return null;
  const [uid, exp, sig] = m[1].split('.');
  const good = sign(`${uid}.${exp}`);
  if (!sig || sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  if (Date.now() > Number(exp)) return null;
  return db.prepare('SELECT id,email,role FROM users WHERE id=?').get(Number(uid)) || null;
}
export function requireUser(req, res, next) {
  const u = readSession(req.headers.cookie);
  if (!u) return res.status(401).json({ error: 'login required' });
  req.user = u;
  next();
}
export const requireAdmin = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'admin only' });

export function canAccessStore(user, storeId) {
  if (user.role === 'admin') return true;
  return !!db.prepare('SELECT 1 FROM user_stores WHERE user_id=? AND store_id=?').get(user.id, storeId);
}
// Middleware factory: resolves the store of a row (or :storeId) and checks access.
export function storeGuard(getStoreId) {
  return (req, res, next) => {
    const sid = getStoreId(req);
    if (sid == null) return res.status(404).json({ error: 'not found' });
    if (!canAccessStore(req.user, sid)) return res.status(403).json({ error: 'no access to this store' });
    req.storeId = sid;
    next();
  };
}
