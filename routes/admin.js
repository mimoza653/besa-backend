const express = require('express');
const router = express.Router();
const { db, hashIdentifier, logEvent } = require('../db');

// POST /admin/ban  { userId, reason }
// Bans a user and permanently blocks their phone number from re-registering,
// even under a new account.
router.post('/ban', (req, res) => {
  const { userId, reason } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required.' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const phoneHash = hashIdentifier(user.phone_number);

  db.prepare(
    `INSERT OR IGNORE INTO banned_identifiers (hash, type) VALUES (?, 'phone')`
  ).run(phoneHash);

  db.prepare(`UPDATE users SET status = 'banned' WHERE id = ?`).run(userId);

  logEvent(userId, 'ban', 'applied', reason || null);

  res.json({ success: true, banned: true });
});

module.exports = router;
