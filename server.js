const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

app.use(express.static(__dirname));
app.use(express.json());

// In-memory session store: sessionId -> { data, clients }
const sessions = new Map();

function getOrCreateSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, { data: null, clients: new Set() });
  }
  return sessions.get(id);
}

// Create new session
app.post('/api/session', (req, res) => {
  const id = crypto.randomBytes(3).toString('hex').toUpperCase();
  getOrCreateSession(id);
  res.json({ sessionId: id });
});

// Get session data (auto-creates if ID provided but not found)
app.get('/api/session/:id', (req, res) => {
  const id = req.params.id.toUpperCase();
  const session = sessions.get(id) || getOrCreateSession(id);
  res.json({ data: session.data });
});

// Serve logo as base64 data URI so it can be embedded in Outlook email
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

// WebSocket: real-time sync between devices on same session
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const sessionId = url.searchParams.get('session')?.toUpperCase();

  if (!sessionId) {
    ws.close(1008, 'Session ID required');
    return;
  }

  const session = getOrCreateSession(sessionId);
  session.clients.add(ws);

  // Send current data to newly joined client
  if (session.data) {
    ws.send(JSON.stringify({ type: 'sync', data: session.data }));
  }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'update') {
        session.data = msg.data;
        // Broadcast to all OTHER clients in this session
        for (const client of session.clients) {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'sync', data: msg.data }));
          }
        }
      }
    } catch {
      // Ignore malformed messages
    }
  });

  const cleanup = () => session.clients.delete(ws);
  ws.on('close', cleanup);
  ws.on('error', cleanup);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Meeting Minutes Tool → http://localhost:${PORT}`);
});
