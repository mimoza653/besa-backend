const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { db, logEvent } = require('../db');

const FACE_MATCH_THRESHOLD = 90; // Rekognition confidence score, 0-100

const DEV_MODE = !process.env.AWS_ACCESS_KEY_ID;

let RekognitionClient, CreateFaceLivenessSessionCommand, GetFaceLivenessSessionResultsCommand;
let rekognition;
if (!DEV_MODE) {
  ({
    RekognitionClient,
    CreateFaceLivenessSessionCommand,
    GetFaceLivenessSessionResultsCommand,
  } = require('@aws-sdk/client-rekognition'));
  rekognition = new RekognitionClient({ region: process.env.AWS_REGION || 'eu-central-1' });
}

// In-memory session store for dev mode only (real mode relies on AWS holding session state)
const devSessions = new Map();

function getUser(userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

// POST /verify/face/session  { userId }
// Creates a liveness session. The client SDK (web/mobile) uses the returned
// sessionId to run the actual camera capture directly against AWS.
router.post('/session', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required.' });

  const user = getUser(userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (!user.phone_verified_at || !user.email_verified_at) {
    return res.status(403).json({ error: 'Complete phone and email verification first.' });
  }

  try {
    let sessionId;
    if (DEV_MODE) {
      sessionId = 'dev-' + crypto.randomUUID();
      devSessions.set(sessionId, { userId, createdAt: Date.now() });
    } else {
      const out = await rekognition.send(new CreateFaceLivenessSessionCommand({}));
      sessionId = out.SessionId;
    }

    logEvent(userId, 'face', 'session_created', sessionId);
    res.json({ sessionId, devMode: DEV_MODE });
  } catch (err) {
    console.error('face/session error:', err.message);
    res.status(500).json({ error: 'Could not start face verification session.' });
  }
});

// POST /verify/face/result  { userId, sessionId, simulate? }
// Fetches the outcome of the liveness session and, if it passes the
// confidence threshold, marks the user's face as verified.
// `simulate` ("pass" | "fail") is dev-mode only, for testing both paths.
router.post('/result', async (req, res) => {
  const { userId, sessionId, simulate } = req.body;
  if (!userId || !sessionId) {
    return res.status(400).json({ error: 'userId and sessionId are required.' });
  }

  const user = getUser(userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  try {
    let confidence, status;

    if (DEV_MODE) {
      const session = devSessions.get(sessionId);
      if (!session || session.userId !== userId) {
        return res.status(404).json({ error: 'Session not found for this user.' });
      }
      status = 'SUCCEEDED';
      confidence = simulate === 'fail' ? 42.0 : 97.5;
    } else {
      const out = await rekognition.send(
        new GetFaceLivenessSessionResultsCommand({ SessionId: sessionId })
      );
      status = out.Status;
      confidence = out.Confidence || 0;
    }

    if (status !== 'SUCCEEDED') {
      logEvent(userId, 'face', 'failed', sessionId);
      return res.status(422).json({ error: `Liveness check status: ${status}. Try again.` });
    }

    const passed = confidence >= FACE_MATCH_THRESHOLD;

    if (passed) {
      db.prepare(
        `UPDATE users SET face_verified_at = CURRENT_TIMESTAMP, face_match_score = ? WHERE id = ?`
      ).run(confidence, userId);
      logEvent(userId, 'face', 'success', sessionId);
    } else {
      logEvent(userId, 'face', 'failed_threshold', sessionId);
    }

    res.json({
      passed,
      confidence,
      threshold: FACE_MATCH_THRESHOLD,
      devMode: DEV_MODE,
    });
  } catch (err) {
    console.error('face/result error:', err.message);
    res.status(500).json({ error: 'Could not retrieve face verification result.' });
  }
});

module.exports = router;
