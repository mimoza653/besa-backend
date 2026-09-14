const express = require('express');
const router = express.Router();
const { db, logEvent } = require('../db');

const DEV_MODE = !process.env.GOOGLE_CLIENT_ID;

let OAuth2Client, appleSignin;
if (!DEV_MODE) {
  OAuth2Client = require('google-auth-library').OAuth2Client;
  appleSignin = require('apple-signin-auth');
}

const googleClient = DEV_MODE ? null : new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Verifies a Google ID token and returns { email }
async function verifyGoogle(idToken) {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload.email_verified) throw new Error('Google email not verified');
  return { email: payload.email };
}

// Verifies an Apple identity token and returns { email }
async function verifyApple(idToken) {
  const payload = await appleSignin.verifyIdToken(idToken, {
    audience: process.env.APPLE_CLIENT_ID,
  });
  return { email: payload.email };
}

// DEV MODE: token is just a base64-encoded JSON string like {"email":"test@example.com"}
// so you can build/test the flow before real OAuth apps are set up.
function verifyDev(token) {
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
    if (!decoded.email) throw new Error();
    return { email: decoded.email };
  } catch {
    throw new Error('Invalid dev token — expected base64 JSON like {"email":"you@example.com"}');
  }
}

// POST /auth/social  { userId, provider, token }
router.post('/social', async (req, res) => {
  const { userId, provider, token } = req.body;

  if (!userId || !provider || !token) {
    return res.status(400).json({ error: 'userId, provider, and token are required.' });
  }
  if (!['apple', 'google'].includes(provider)) {
    return res.status(400).json({ error: 'provider must be "apple" or "google".' });
  }

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found. Complete phone verification first.' });
  }

  try {
    let result;
    if (DEV_MODE) {
      result = verifyDev(token);
    } else if (provider === 'google') {
      result = await verifyGoogle(token);
    } else {
      result = await verifyApple(token);
    }

    db.prepare(
      `UPDATE users SET email = ?, email_verified_at = CURRENT_TIMESTAMP, auth_provider = ? WHERE id = ?`
    ).run(result.email, provider, userId);

    logEvent(userId, 'email', 'success', provider);

    res.json({ success: true, email: result.email, devMode: DEV_MODE });
  } catch (err) {
    logEvent(userId, 'email', 'failed', provider);
    console.error('auth/social error:', err.message);
    res.status(401).json({ error: 'Could not verify social login token.' });
  }
});

module.exports = router;
