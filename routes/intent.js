const express = require('express');
const router = express.Router();
const { db, logEvent } = require('../db');

const VALID_INTENTS = ['marriage', 'ltr', 'unsure'];

function computeTrustScore(user) {
  let score = 0;
  if (user.phone_verified_at) score += 25;
  if (user.email_verified_at) score += 25;
  if (user.face_verified_at) score += 35;
  if (user.intent) score += 15;

  let badge;
  if (score >= 85) badge = 'Fully Verified';
  else if (score >= 50) badge = 'Partially Verified';
  else badge = 'Unverified';

  return { score, badge };
}

function getUser(userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

// POST /profile/intent  { userId, intent }
// Final step — requires phone, email, and face verification to already be complete.
// Intent is never hidden once set; it can be changed later but the original
// declaration timestamp (intent_locked_at) is preserved.
router.post('/intent', (req, res) => {
  const { userId, intent } = req.body;

  if (!userId || !intent) {
    return res.status(400).json({ error: 'userId and intent are required.' });
  }
  if (!VALID_INTENTS.includes(intent)) {
    return res.status(400).json({ error: `intent must be one of: ${VALID_INTENTS.join(', ')}` });
  }

  const user = getUser(userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  if (!user.phone_verified_at || !user.email_verified_at || !user.face_verified_at) {
    return res.status(403).json({
      error: 'Complete phone, email, and face verification before declaring intent.',
    });
  }

  db.prepare(
    `UPDATE users
     SET intent = ?, intent_locked_at = COALESCE(intent_locked_at, CURRENT_TIMESTAMP)
     WHERE id = ?`
  ).run(intent, userId);

  logEvent(userId, 'intent', 'success', intent);

  const updated = getUser(userId);
  res.json({ success: true, intent: updated.intent, ...computeTrustScore(updated) });
});

// GET /profile/trust-score/:userId
router.get('/trust-score/:userId', (req, res) => {
  const user = getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  res.json({
    userId: user.id,
    ...computeTrustScore(user),
    breakdown: {
      phone_verified: !!user.phone_verified_at,
      email_verified: !!user.email_verified_at,
      face_verified: !!user.face_verified_at,
      intent_declared: !!user.intent,
    },
  });
});

module.exports = router;
