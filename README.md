# besa-backend

Phone verification API — step 1 of the verification flow (see the design prototype and integration spec).

## Setup

```bash
npm install
cp .env.example .env
```

Leave the Twilio fields in `.env` blank to run in **DEV MODE**: any phone number accepts the code `123456`, logged to the console instead of sent via SMS. This lets you build the rest of the app before paying for a Twilio account.

To go live, fill in `.env`:
```
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxx
TWILIO_VERIFY_SERVICE_SID=VAxxxxxxxx
```
(Get these from the Twilio Console → Verify → create a Verify Service.)

## Run

```bash
node server.js
```

Server starts on `http://localhost:3000`.

## Endpoints

**POST /verify/phone/start**
```json
{ "phone": "+355691234567" }
```
Sends (or, in dev mode, logs) a 6-digit code. Phone must be in E.164 format (`+` + country code + number, no spaces).

**POST /verify/phone/confirm**
```json
{ "phone": "+355691234567", "code": "123456" }
```
Confirms the code. On success, marks the user's phone as verified and returns their `userId`.

**POST /auth/social**
```json
{ "userId": 1, "provider": "google", "token": "..." }
```
Verifies a Google or Apple sign-in token and attaches the resulting verified email to that user. `userId` comes from the phone verification step. In dev mode (no `GOOGLE_CLIENT_ID`/`APPLE_CLIENT_ID` set), `token` is just base64 of `{"email":"you@example.com"}` — generate one with:
```bash
node -e "console.log(Buffer.from(JSON.stringify({email:'you@example.com'})).toString('base64'))"
```

**GET /health**
Basic liveness check.

---

**POST /verify/face/session**
```json
{ "userId": 1 }
```
Starts a face liveness session — requires phone and email verification to be complete first. Returns a `sessionId`. In production, your web/mobile client uses this ID with the AWS Amplify Face Liveness SDK to run the actual camera capture directly against AWS (the backend never touches the video).

**POST /verify/face/result**
```json
{ "userId": 1, "sessionId": "..." }
```
Fetches the outcome and, if confidence ≥ 90, marks the user's face as verified. In dev mode, add `"simulate": "pass"` or `"simulate": "fail"` to the body to test both outcomes without a real camera capture.

---

**POST /profile/intent**
```json
{ "userId": 1, "intent": "marriage" }
```
Final step — requires phone, email, and face verification to already be complete. `intent` must be one of `marriage`, `ltr`, `unsure`. Can be changed later, but the original declaration timestamp is preserved and the field is never hidden from the profile.

**GET /profile/trust-score/:userId**
Returns the current score (0–100) and badge (`Unverified` / `Partially Verified` / `Fully Verified`), plus a breakdown of which steps are complete. Scoring: phone 25, email 25, face 35, intent 15.

## Data

Uses SQLite (`besa.db`, created automatically on first run) — good for local dev, swap for Postgres before production scale. Schema is in `db.js`.

## Status

All four verification steps from the integration spec are implemented and tested: phone (Twilio), email/social (Apple/Google), face (AWS Rekognition liveness), and intent + trust score. The frontend prototype (`besa-verification-flow.html`) is wired to this API — run this server first (`node server.js`), then open the prototype in a browser and it will call these endpoints live (look for "API connected" in the top-right corner).

## Next steps

- Swap SQLite for Postgres before production scale
- Add rate limiting on `/verify/phone/start` to prevent SMS-bombing abuse
- Real Apple/Google login requires registering OAuth apps with those providers and swapping the prototype's dev-mode token generation for their actual SDKs
- Real AWS setup requires the Amplify Face Liveness SDK on the client to capture video — this backend only creates the session and reads the result
