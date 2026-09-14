require('dotenv').config();
const express = require('express');
const cors = require('cors');
const verifyRoutes = require('./routes/verify');
const authRoutes = require('./routes/auth');
const faceRoutes = require('./routes/face');
const intentRoutes = require('./routes/intent');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/verify', verifyRoutes);
app.use('/auth', authRoutes);
app.use('/verify/face', faceRoutes);
app.use('/profile', intentRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`besa-backend listening on port ${PORT}`);
  if (!process.env.TWILIO_ACCOUNT_SID) {
    console.log('Running in DEV MODE — no Twilio credentials found. OTP code is always 123456.');
  }
});
