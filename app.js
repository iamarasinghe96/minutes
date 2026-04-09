/* ═══════════════════════════════════════════════════════════════
   Meeting Minutes Tool – Frontend Logic
   ═══════════════════════════════════════════════════════════════ */

// ── State ───────────────────────────────────────────────────────
let sessionId  = null;
let ws         = null;
let isSyncing  = false;   // prevent echo when we receive remote updates
let syncTimer  = null;    // debounce timer for sync

// ── Gemini prompt template ──────────────────────────────────────
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
[PASTE YOUR TRANSCRIPTION HERE]`;

// ── Bootstrap ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Populate Gemini prompt in modal
  document.getElementById('promptText').textContent = GEMINI_PROMPT;

  // Load logo: try /api/logo (Node server, returns base64 for Outlook embedding),
  // then fall back to static file paths for GitHub Pages / static hosting.
  function setLogoSrc(src) {
    document.querySelectorAll('.header-logo, .mm-logo').forEach(img => {
      img.src = src;
      img.style.display = '';
    });
  }
  function tryStaticLogo() {
    const exts = ['png', 'jpg', 'jpeg', 'svg', 'gif'];
    let i = 0;
    function next() {
      if (i >= exts.length) return;
      const ext = exts[i++];
      const t = new Image();
      t.onload = () => setLogoSrc(`assets/logo/logo.${ext}`);
      t.onerror = next;
      t.src = `assets/logo/logo.${ext}`;
    }
    next();
  }
  try {
    const res = await fetch('/api/logo');
    if (res.ok) {
      const { dataUri } = await res.json();
      setLogoSrc(dataUri);
    } else {
      tryStaticLogo();
    }
  } catch { tryStaticLogo(); }

  // Initialise 3 blank follow-up rows
  resetFollowupRows(3);

  // Resolve session
  const params = new URLSearchParams(window.location.search);
  let sid = params.get('session');

  if (sid) {
    sessionId = sid.toUpperCase();
    // Fetch any existing data from the server
    try {
      const res  = await fetch(`/api/session/${sessionId}`);
      const body = await res.json();
      if (body.data) {
        isSyncing = true;
        populateForm(body.data);
        isSyncing = false;
      }
    } catch { /* server unreachable; work offline */ }
  } else {
    try {
      const res  = await fetch('/api/session', { method: 'POST' });
      const body = await res.json();
      sessionId  = body.sessionId;
      window.history.replaceState({}, '', `?session=${sessionId}`);
    } catch {
      // Fallback: local-only random ID
      sessionId = Math.random().toString(36).slice(2, 8).toUpperCase();
      window.history.replaceState({}, '', `?session=${sessionId}`);
    }
  }

  document.getElementById('sessionId').textContent = sessionId;
  connectWebSocket();
});

// ── WebSocket ───────────────────────────────────────────────────
function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl    = `${protocol}//${location.host}/ws?session=${sessionId}`;

  try {
    ws = new WebSocket(wsUrl);
  } catch {
    setSyncStatus('offline');
    setTimeout(connectWebSocket, 5000);
    return;
  }

  ws.onopen = () => setSyncStatus('online');

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'sync') {
        isSyncing = true;
        populateForm(msg.data);
        isSyncing = false;
      }
    } catch { /* ignore */ }
  };

  ws.onclose = () => {
    setSyncStatus('offline');
    setTimeout(connectWebSocket, 4000);
  };

  ws.onerror = () => setSyncStatus('offline');
}

function setSyncStatus(state) {
  const dot  = document.getElementById('syncDot');
  const text = document.getElementById('syncText');
  dot.className = `sync-dot ${state}`;
  const labels = { online: 'Synced', offline: 'Disconnected', waiting: 'Syncing…' };
  text.textContent = labels[state] || state;
}

// ── Sync ────────────────────────────────────────────────────────
// Call this whenever a field changes; debounces 300 ms
function scheduleSync() {
  if (isSyncing) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(doSync, 300);
}

function doSync() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    setSyncStatus('waiting');
    ws.send(JSON.stringify({ type: 'update', data: collectFormData() }));
    setSyncStatus('online');
  }
}

// ── Collect / populate form ─────────────────────────────────────
function collectFormData() {
  const rows = [];
  document.querySelectorAll('#followupBody tr').forEach(tr => {
    const tds = tr.querySelectorAll('td');
    rows.push({
      point:    tds[0]?.innerText.trim() || '',
      person:   tds[1]?.innerText.trim() || '',
      deadline: tds[2]?.innerText.trim() || '',
    });
  });

  return {
    meeting_topic:      document.getElementById('fTopic').value,
    date:               document.getElementById('fDate').value,
    host:               document.getElementById('fHost').value,
    participants:       document.getElementById('fParticipants').value,
    preface:            document.getElementById('fPreface').innerText,
    discussion_points:  document.getElementById('fDiscussion').innerText,
    follow_up_actions:  rows,
  };
}

function populateForm(data) {
  if (!data) return;

  const set = (id, val) => {
    if (val === undefined) return;
    const el = document.getElementById(id);
    if (el.tagName === 'INPUT') el.value = val;
    else el.innerText = val;
  };

  set('fTopic',        data.meeting_topic);
  set('fDate',         data.date);
  set('fHost',         data.host);
  set('fParticipants', data.participants);
  set('fPreface',      data.preface);
  set('fDiscussion',   data.discussion_points);

  if (Array.isArray(data.follow_up_actions)) {
    const rows = [...data.follow_up_actions];
    // Ensure at least 3 rows
    while (rows.length < 3) rows.push({ point: '', person: '', deadline: '' });
    renderFollowupRows(rows);
  }
}

// ── Follow-up table helpers ─────────────────────────────────────
function resetFollowupRows(n) {
  const blank = [];
  for (let i = 0; i < n; i++) blank.push({ point: '', person: '', deadline: '' });
  renderFollowupRows(blank);
}

function renderFollowupRows(rows) {
  const tbody = document.getElementById('followupBody');
  tbody.innerHTML = '';
  rows.forEach(row => tbody.appendChild(makeRow(row)));
}

function makeRow({ point = '', person = '', deadline = '' } = {}) {
  const tr = document.createElement('tr');
  [point, person, deadline].forEach(val => {
    const td = document.createElement('td');
    td.contentEditable = 'true';
    td.innerText = val;
    td.addEventListener('input', scheduleSync);
    tr.appendChild(td);
  });
  return tr;
}

function addRow() {
  document.getElementById('followupBody').appendChild(makeRow());
  scheduleSync();
}

function removeLastRow() {
  const tbody = document.getElementById('followupBody');
  if (tbody.rows.length > 1) {
    tbody.deleteRow(tbody.rows.length - 1);
    scheduleSync();
  }
}

// ── Parse Gemini output ─────────────────────────────────────────
function parseGeminiOutput() {
  const raw = document.getElementById('geminiInput').value.trim();
  if (!raw) { showToast('Paste the Gemini JSON output first.', 'error'); return; }

  let data;
  try {
    // Strip optional markdown code fences (```json ... ```)
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    data = JSON.parse(cleaned);
  } catch {
    showToast('Could not parse JSON. Make sure Gemini replied with pure JSON.', 'error');
    return;
  }

  populateForm(data);
  scheduleSync();
  showToast('Meeting minutes populated!', 'success');
}

// ── Copy for Outlook ────────────────────────────────────────────
async function copyForOutlook() {
  const data = collectFormData();

  // Try to get logo as embedded base64 (so it shows in Outlook)
  let logoHtml = '';
  try {
    const res = await fetch('/api/logo');
    if (res.ok) {
      const { dataUri } = await res.json();
      logoHtml = `
        <tr>
          <td colspan="2" style="padding:8px 12px 4px;">
            <img src="${dataUri}" height="52" style="height:52px;display:block;" alt="Logo">
          </td>
        </tr>`;
    }
  } catch { /* no logo, fine */ }

  const html = buildOutlookHTML(data, logoHtml);

  try {
    await navigator.clipboard.write([
      new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) }),
    ]);
    showToast('Copied! Paste into your Outlook email.', 'success');
  } catch {
    // Fallback: show a modal with the raw HTML for manual copy
    fallbackCopy(html);
  }
}

// ── Build Outlook-compatible HTML ───────────────────────────────
function buildOutlookHTML(data, logoHtml) {
  const RED    = '#B20000';
  const BORDER = '1px solid #CCCCCC';
  const CELL   = `border:${BORDER};padding:8px 12px;font-family:Calibri,Arial,sans-serif;font-size:14px;`;
  const LABEL  = `${CELL}width:175px;font-weight:600;vertical-align:top;background:#FAFAFA;`;

  // Preface / discussion: keep plain text, convert newlines to <br>
  const nl2br = txt => esc(txt).replace(/\n/g, '<br>');

  // Follow-up rows; always at least 3
  const actions = [...(data.follow_up_actions || [])];
  while (actions.length < 3) actions.push({ point: '', person: '', deadline: '' });
  const fuRows = actions.map(r => `
    <tr>
      <td style="${CELL}">${esc(r.point)}</td>
      <td style="${CELL}">${esc(r.person)}</td>
      <td style="${CELL}">${esc(r.deadline)}</td>
    </tr>`).join('');

  return `
<table cellpadding="0" cellspacing="0" border="0"
       style="border-collapse:collapse;width:720px;max-width:720px;font-family:Calibri,Arial,sans-serif;">
  <tbody>
    ${logoHtml}
    <!-- Title -->
    <tr>
      <td colspan="2" bgcolor="${RED}"
          style="background-color:${RED};color:#FFFFFF;text-align:center;
                 padding:10px;font-size:18px;font-weight:bold;
                 font-family:Calibri,Arial,sans-serif;">
        Meeting Minutes
      </td>
    </tr>
    <!-- Info rows -->
    <tr>
      <td style="${LABEL}">Meeting Topic:</td>
      <td style="${CELL}">${esc(data.meeting_topic)}</td>
    </tr>
    <tr>
      <td style="${LABEL}">Date:</td>
      <td style="${CELL}">${esc(data.date)}</td>
    </tr>
    <tr>
      <td style="${LABEL}">Host:</td>
      <td style="${CELL}">${esc(data.host)}</td>
    </tr>
    <tr>
      <td style="${LABEL}">Participants:</td>
      <td style="${CELL}">${esc(data.participants)}</td>
    </tr>
    <!-- Body text -->
    <tr>
      <td colspan="2" style="${CELL}">
        <p style="margin:0 0 4px;"><strong>Preface:</strong></p>
        <p style="margin:0 0 14px;">${nl2br(data.preface)}</p>
        <p style="margin:0 0 4px;"><strong>Discussion Points:</strong></p>
        <p style="margin:0 0 14px;">${nl2br(data.discussion_points)}</p>
        <p style="margin:0 0 4px;"><strong>Follow up points:</strong></p>
      </td>
    </tr>
    <!-- Follow-up table -->
    <tr>
      <td colspan="2" style="padding:0;border:${BORDER};">
        <table cellpadding="0" cellspacing="0" border="0"
               style="border-collapse:collapse;width:100%;">
          <thead>
            <tr>
              <th bgcolor="${RED}"
                  style="background-color:${RED};color:#FFFFFF;padding:8px 12px;
                         text-align:center;font-family:Calibri,Arial,sans-serif;
                         font-size:14px;font-weight:bold;width:34%;">Point</th>
              <th bgcolor="${RED}"
                  style="background-color:${RED};color:#FFFFFF;padding:8px 12px;
                         text-align:center;font-family:Calibri,Arial,sans-serif;
                         font-size:14px;font-weight:bold;width:33%;">Person</th>
              <th bgcolor="${RED}"
                  style="background-color:${RED};color:#FFFFFF;padding:8px 12px;
                         text-align:center;font-family:Calibri,Arial,sans-serif;
                         font-size:14px;font-weight:bold;width:33%;">Deadline</th>
            </tr>
          </thead>
          <tbody>${fuRows}</tbody>
        </table>
      </td>
    </tr>
    <!-- Footer -->
    <tr>
      <td colspan="2"
          style="${CELL}text-align:center;font-style:italic;color:#555555;font-size:13px;">
        ~~~Minutes prepared by Indika~~~
      </td>
    </tr>
  </tbody>
</table>`.trim();
}

function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Fallback HTML copy (older browsers / HTTP) ──────────────────
function fallbackCopy(html) {
  // Insert a temporary contenteditable div, select it, execCommand copy
  const div = document.createElement('div');
  div.contentEditable = 'true';
  div.style.cssText   = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
  div.innerHTML       = html;
  document.body.appendChild(div);

  const range = document.createRange();
  range.selectNodeContents(div);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  try {
    document.execCommand('copy');
    showToast('Copied! Paste into your Outlook email.', 'success');
  } catch {
    showToast('Auto-copy failed. Please select and copy the table manually.', 'error');
  }

  sel.removeAllRanges();
  document.body.removeChild(div);
}

// ── Clear ───────────────────────────────────────────────────────
function clearAll() {
  ['fTopic','fDate','fHost','fParticipants'].forEach(id => {
    document.getElementById(id).value = '';
  });
  ['fPreface','fDiscussion'].forEach(id => {
    document.getElementById(id).innerText = '';
  });
  resetFollowupRows(3);
  scheduleSync();
}

// ── Session link ────────────────────────────────────────────────
function copySessionLink() {
  const url = `${location.origin}${location.pathname}?session=${sessionId}`;
  navigator.clipboard.writeText(url)
    .then(() => showToast('Link copied! Open it on any device.', 'success'))
    .catch(() => showToast(`Share this URL: ${url}`, 'error'));
}

// ── Gemini prompt modal ─────────────────────────────────────────
function openPromptModal()  { document.getElementById('promptModal').classList.remove('hidden'); }
function closePromptModal(e) {
  if (!e || e.target === document.getElementById('promptModal') || !e.target) {
    document.getElementById('promptModal').classList.add('hidden');
  }
}

function copyPrompt() {
  navigator.clipboard.writeText(GEMINI_PROMPT)
    .then(() => showToast('Prompt copied!', 'success'))
    .catch(() => showToast('Could not copy automatically.', 'error'));
}

// ── Toast notifications ─────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent  = msg;
  toast.className    = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3400);
}
