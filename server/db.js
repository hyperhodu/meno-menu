import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(process.env.DB_FILE || path.join(DATA_DIR, 'menu.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL, salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','manager')));
CREATE TABLE IF NOT EXISTS stores(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'UTC');
CREATE TABLE IF NOT EXISTS user_stores(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id, store_id));
CREATE TABLE IF NOT EXISTS media(
  id INTEGER PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  file TEXT NOT NULL, original_name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('image','video')),
  mime TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS playlists(
  id INTEGER PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS playlist_items(
  id INTEGER PRIMARY KEY, playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, duration_sec INTEGER NOT NULL DEFAULT 10);
CREATE TABLE IF NOT EXISTS screens(
  id INTEGER PRIMARY KEY, store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT, pair_code TEXT UNIQUE, token TEXT UNIQUE NOT NULL,
  default_playlist_id INTEGER REFERENCES playlists(id) ON DELETE SET NULL,
  last_seen TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS schedules(
  id INTEGER PRIMARY KEY, screen_id INTEGER NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  days TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6', start_min INTEGER NOT NULL, end_min INTEGER NOT NULL);
`);
