require('dotenv').config();
const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.static(__dirname));
app.use(express.json({ limit: '2mb' }));

const OFFICE_EMAIL   = 'indika.arasinghe@alburycity.nsw.gov.au';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

const GEMINI_PROMPT = `You are a professional meeting minutes formatter.
Analyse the following meeting transcription and extract key information
into this EXACT JSON format.

OUTPUT ONLY THE JSON — no markdown, no code fences, no explanation.

{
  "meeting_topic": "Brief descriptive title",
  "date": "DD/MM/YYYY (if mentioned, otherwise leave blank)",
  "host": "Name of the meeting host or chairperson",
  "participants": "Comma-separated list of all participants",
  "preface": "1-2 sentences about the purpose and context of the meeting",
  "discussion_points": "Key topics discussed, each on a new line starting with • ",
  "follow_up_actions": [
    {
      "point": "Specific action item description",
      "person": "Person responsible",
      "deadline": "Deadline or timeframe (e.g. 15/04/2025, Next meeting, ASAP)"
    }
  ]
}

Meeting Transcription:
`;

// Serve logo as base64 data URI for email embedding
app.get('/api/logo', (req, res) => {
  const logoDir = path.join(__dirname, 'assets', 'logo');
  const exts = ['png', 'jpg', 'jpeg', 'gif', 'svg'];
  for (const ext of exts) {
    const logoPath = path.join(logoDir, `logo.${ext}`);
    if (fs.existsSync(logoPath)) {
      const data = fs.readFileSync(logoPath);
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
      return res.json({ dataUri: `data:${mime};base64,${data.toString('base64')}` });
    }
  }
  res.status(404).json({ error: 'No logo found' });
});

// Extract meeting minutes from transcription using Gemini
app.post('/api/extract', async (req, res) => {
  const { transcription } = req.body;
  if (!transcription?.trim()) {
    return res.status(400).json({ error: 'No transcription provided.' });
  }
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Gemini API key not configured.' });
  }

  try {
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: GEMINI_PROMPT + transcription }] }],
        generationConfig: { temperature: 0.2 }
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ error: `Gemini API error: ${response.status}`, detail: err });
    }

    const result = await response.json();
    const raw = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const data = JSON.parse(cleaned);
    res.json({ data });
  } catch (err) {
    console.error('Extract error:', err);
    res.status(500).json({ error: err.message || 'Failed to extract minutes.' });
  }
});

// Send meeting minutes email
app.post('/api/send-email', async (req, res) => {
  const { html, subject } = req.body;
  if (!html) return res.status(400).json({ error: 'No HTML content provided.' });

  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass || smtpPass === 'your_password_here') {
    return res.status(500).json({ error: 'SMTP credentials not configured in .env file.' });
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.office365.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    auth: { user: smtpUser, pass: smtpPass },
    tls: { ciphers: 'SSLv3' }
  });

  try {
    await transporter.sendMail({
      from: `"AlburyCity Council" <${smtpUser}>`,
      to: OFFICE_EMAIL,
      subject: subject || 'Meeting Minutes — AlburyCity Council',
      html,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Email error:', err);
    res.status(500).json({ error: err.message || 'Failed to send email.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AlburyCity Council Minutes Tool → http://localhost:${PORT}`);
});
