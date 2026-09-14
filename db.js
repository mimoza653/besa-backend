const Database = require('better-sqlite3');
const crypto = require('crypto');

const db = new Database('besa.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_number TEXT UNIQUE,
    phone_verified_at TEXT,
    email TEXT,
    email_verified_at TEXT,
    auth_provider TEXT,
    face_verified_at TEXT,
    face_match_score REAL,
    intent TEXT,
    intent_locked_at TEXT,
    status TEXT DEFAULT 'pending',
    banned_phone_hash TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS verification_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    step TEXT,
    result TEXT,
    provider_ref TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS banned_identifiers (
    hash TEXT PRIMARY KEY,
    type TEXT,
    banned_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

function hashIdentifier(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isBanned(value) {
  const hash = hashIdentifier(value);
  const row = db.prepare('SELECT 1 FROM banned_identifiers WHERE hash = ?').get(hash);
  return !!row;
}

function logEvent(userId, step, result, providerRef = null) {
  db.prepare(
    'INSERT INTO verification_events (user_id, step, result, provider_ref) VALUES (?, ?, ?, ?)'
  ).run(userId, step, result, providerRef);
}

module.exports = { db, hashIdentifier, isBanned, logEvent };
