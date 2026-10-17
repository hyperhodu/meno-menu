import { createApp } from './app.js';
import { db } from './db.js';
import { hashPassword } from './auth.js';

// First run: create the admin from env vars.
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const email = process.env.ADMIN_EMAIL, pw = process.env.ADMIN_PASSWORD;
  if (!email || !pw) { console.error('First run: set ADMIN_EMAIL and ADMIN_PASSWORD'); process.exit(1); }
  const { salt, hash } = hashPassword(pw);
  db.prepare("INSERT INTO users(email,pass_hash,salt,role) VALUES(?,?,?,'admin')").run(email.toLowerCase(), hash, salt);
  console.log('Created admin', email);
}
const port = process.env.PORT || 3000;
createApp().listen(port, () => console.log(`Digital Menu on :${port}`));
