const express = require('express');
const router = express.Router();
const { db, isBanned, logEvent } = require('../db');

// Twilio only initializes if credentials are present.
// Without them, we run in DEV MODE: any phone gets code "123456", logged to console.
const DEV_MODE = !process.env.TWILIO_ACCOUNT_SID;
let twilioClient = null;
if (!DEV_MODE) {
  twilioClient = require('twilio')(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
}

function isValidPhone(phone) {
  return /^\+[1-9]\d{6,14}$/.test(phone); // E.164 format, e.g. +355691234567
}

// POST /verify/phone/start  { phone }
router.post('/phone/start', async (req, res) => {
  const { phone } = req.body;

  if (!phone || !isValidPhone(phone)) {
    return res.status(400).json({ error: 'Phone number must be in E.164 format, e.g. +355691234567' });
  }

  if (isBanned(phone)) {
    return res.status(403).json({ error: 'This number is not eligible to register.' });
  }

  try {
    if (DEV_MODE) {
      console.log(`[DEV MODE] OTP for ${phone} is 123456`);
    } else {
      await twilioClient.verify.v2
        .services(process.env.TWILIO_VERIFY_SERVICE_SID)
        .verifications.create({ to: phone, channel: 'sms' });
    }

    // Ensure a user row exists for this phone (status: pending)
    db.prepare(
      `INSERT INTO users (phone_number, status) VALUES (?, 'pending')
       ON CONFLICT(phone_number) DO NOTHING`
    ).run(phone);

    res.json({ success: true, devMode: DEV_MODE });
  } catch (err) {
    console.error('phone/start error:', err.message);
    res.status(500).json({ error: 'Could not send verification code. Try again shortly.' });
  }
});

// POST /verify/phone/confirm  { phone, code }
router.post('/phone/confirm', async (req, res) => {
  const { phone, code } = req.body;

  if (!phone || !code) {
    return res.status(400).json({ error: 'Phone and code are required.' });
  }

  try {
    let approved = false;

    if (DEV_MODE) {
      approved = code === '123456';
    } else {
      const check = await twilioClient.verify.v2
        .services(process.env.TWILIO_VERIFY_SERVICE_SID)
        .verificationChecks.create({ to: phone, code });
      approved = check.status === 'approved';
    }

    const user = db.prepare('SELECT id FROM users WHERE phone_number = ?').get(phone);

    if (!approved) {
      if (user) logEvent(user.id, 'phone', 'failed');
      return res.status(401).json({ error: 'Incorrect or expired code.' });
    }

    db.prepare(
      `UPDATE users SET phone_verified_at = CURRENT_TIMESTAMP, status = 'active' WHERE phone_number = ?`
    ).run(phone);

    if (user) logEvent(user.id, 'phone', 'success');

    res.json({ success: true, userId: user ? user.id : null });
  } catch (err) {
    console.error('phone/confirm error:', err.message);
    res.status(500).json({ error: 'Could not verify code. Try again shortly.' });
  }
});

module.exports = router;
