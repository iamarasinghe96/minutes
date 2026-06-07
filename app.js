/* ═══════════════════════════════════════════════════════════════
   AlburyCity Council — Meeting Minutes Tool — Frontend Logic
   ═══════════════════════════════════════════════════════════════ */

const GEMINI_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=';

function getApiKey() {
  return localStorage.getItem('gemini_api_key') || '';
}

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

// ── Bootstrap ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  resetFollowupRows(3);

  // Try to load logo from static files
  const exts = ['png', 'jpg', 'jpeg', 'svg', 'gif'];
  let i = 0;
  function tryNext() {
    if (i >= exts.length) return;
    const ext = exts[i++];
    const t = new Image();
    t.onload = () => {
      document.querySelectorAll('.header-logo, .mm-logo').forEach(img => {
        img.src = t.src;
        img.style.display = '';
      });
    };
    t.onerror = tryNext;
    t.src = `assets/logo/logo.${ext}`;
  }
  tryNext();
});

// ── AI Extraction (reads from clipboard) ────────────────────────
async function pasteAndExtract() {
  const btn = document.getElementById('extractBtn');
  btn.disabled = true;
  btn.textContent = 'Reading clipboard…';

  let transcription = '';
  try {
    transcription = await navigator.clipboard.readText();
  } catch {
    transcription = window.prompt('Clipboard access was blocked.\nPaste your transcription here:') || '';
  }

  if (!transcription.trim()) {
    showToast('Nothing found in clipboard. Copy your transcription first.', 'error');
    btn.disabled = false;
    btn.textContent = '📋 Paste & Extract with AI';
    return;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    showToast('No API key set. Click ⚙ to configure.', 'error');
    btn.disabled = false;
    btn.textContent = '📋 Paste & Extract with AI';
    return;
  }

  btn.textContent = 'Extracting…';
  try {
    const response = await fetch(GEMINI_URL_BASE + apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: GEMINI_PROMPT + transcription }] }],
        generationConfig: { temperature: 0.2 }
      })
    });

    if (!response.ok) {
      const err = await response.json();
      showToast(err.error?.message || 'Gemini API error.', 'error');
      return;
    }

    const result = await response.json();
    const raw = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const data = JSON.parse(cleaned);
    populateForm(data);
    showToast('Meeting minutes populated!', 'success');
  } catch (err) {
    showToast('Extraction failed: ' + (err.message || 'Unknown error'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '📋 Paste & Extract with AI';
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
    tr.appendChild(td);
  });
  return tr;
}

function addRow() {
  document.getElementById('followupBody').appendChild(makeRow());
}

function removeLastRow() {
  const tbody = document.getElementById('followupBody');
  if (tbody.rows.length > 1) tbody.deleteRow(tbody.rows.length - 1);
}

// ── Copy for Outlook ────────────────────────────────────────────
async function copyForOutlook() {
  const data = collectFormData();
  const btn  = document.getElementById('emailBtn');
  btn.disabled = true;
  btn.textContent = 'Copying…';

  // Try to embed logo as base64
  let logoHtml = '';
  try {
    const exts = ['png', 'jpg', 'jpeg', 'svg', 'gif'];
    for (const ext of exts) {
      const res = await fetch(`assets/logo/logo.${ext}`);
      if (!res.ok) continue;
      const blob = await res.blob();
      const dataUri = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
      logoHtml = `
        <tr>
          <td colspan="2" style="padding:8px 12px 4px;">
            <img src="${dataUri}" height="60" style="height:60px;display:block;" alt="AlburyCity Council">
          </td>
        </tr>`;
      break;
    }
  } catch { /* no logo */ }

  const html = buildEmailHTML(data, logoHtml);

  try {
    await navigator.clipboard.write([
      new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) }),
    ]);
    showToast('Copied! Paste into your Outlook email.', 'success');
  } catch {
    // Fallback: select + execCommand
    const div = document.createElement('div');
    div.contentEditable = 'true';
    div.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
    div.innerHTML = html;
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
      showToast('Auto-copy failed — please copy manually.', 'error');
    }
    sel.removeAllRanges();
    document.body.removeChild(div);
  }

  btn.disabled = false;
  btn.textContent = '📋 Copy for Outlook';
}

// ── Build Outlook-compatible HTML ───────────────────────────────
function buildEmailHTML(data, logoHtml) {
  const BLUE   = '#28428D';
  const BORDER = '1px solid #CCCCCC';
  const CELL   = `border:${BORDER};padding:8px 12px;font-family:Calibri,Arial,sans-serif;font-size:14px;`;
  const LABEL  = `${CELL}width:175px;font-weight:600;vertical-align:top;background:#D8FAD5;`;

  const nl2br = txt => esc(txt).replace(/\n/g, '<br>');

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
    <tr>
      <td colspan="2" bgcolor="${BLUE}"
          style="background-color:${BLUE};color:#FFFFFF;text-align:center;
                 padding:10px;font-size:18px;font-weight:bold;
                 font-family:Calibri,Arial,sans-serif;">
        Meeting Minutes
      </td>
    </tr>
    <tr><td style="${LABEL}">Meeting Topic:</td><td style="${CELL}">${esc(data.meeting_topic)}</td></tr>
    <tr><td style="${LABEL}">Date:</td><td style="${CELL}">${esc(data.date)}</td></tr>
    <tr><td style="${LABEL}">Host:</td><td style="${CELL}">${esc(data.host)}</td></tr>
    <tr><td style="${LABEL}">Participants:</td><td style="${CELL}">${esc(data.participants)}</td></tr>
    <tr>
      <td colspan="2" style="${CELL}">
        <p style="margin:0 0 4px;"><strong>Preface:</strong></p>
        <p style="margin:0 0 14px;">${nl2br(data.preface)}</p>
        <p style="margin:0 0 4px;"><strong>Discussion Points:</strong></p>
        <p style="margin:0 0 14px;">${nl2br(data.discussion_points)}</p>
        <p style="margin:0 0 4px;"><strong>Follow up points:</strong></p>
      </td>
    </tr>
    <tr>
      <td colspan="2" style="padding:0;border:${BORDER};">
        <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;">
          <thead>
            <tr>
              <th bgcolor="${BLUE}" style="background-color:${BLUE};color:#FFFFFF;padding:8px 12px;text-align:center;font-family:Calibri,Arial,sans-serif;font-size:14px;font-weight:bold;width:34%;">Point</th>
              <th bgcolor="${BLUE}" style="background-color:${BLUE};color:#FFFFFF;padding:8px 12px;text-align:center;font-family:Calibri,Arial,sans-serif;font-size:14px;font-weight:bold;width:33%;">Person</th>
              <th bgcolor="${BLUE}" style="background-color:${BLUE};color:#FFFFFF;padding:8px 12px;text-align:center;font-family:Calibri,Arial,sans-serif;font-size:14px;font-weight:bold;width:33%;">Deadline</th>
            </tr>
          </thead>
          <tbody>${fuRows}</tbody>
        </table>
      </td>
    </tr>
    <tr>
      <td colspan="2" style="${CELL}text-align:center;font-style:italic;color:#555555;font-size:13px;">
        ~~~Minutes prepared by Indika — AlburyCity Council~~~
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

// ── Clear ───────────────────────────────────────────────────────
function clearAll() {
  ['fTopic','fDate','fHost','fParticipants'].forEach(id => {
    document.getElementById(id).value = '';
  });
  ['fPreface','fDiscussion'].forEach(id => {
    document.getElementById(id).innerText = '';
  });
  resetFollowupRows(3);
}

// ── API Key settings ────────────────────────────────────────────
function openSettings() {
  document.getElementById('apiKeyInput').value = getApiKey();
  document.getElementById('settingsModal').classList.remove('hidden');
}
function closeSettings(e) {
  if (!e || e.target === document.getElementById('settingsModal')) {
    document.getElementById('settingsModal').classList.add('hidden');
  }
}
function saveApiKey() {
  const key = document.getElementById('apiKeyInput').value.trim();
  if (key) {
    localStorage.setItem('gemini_api_key', key);
    showToast('API key saved!', 'success');
  } else {
    localStorage.removeItem('gemini_api_key');
    showToast('API key cleared.', 'success');
  }
  document.getElementById('settingsModal').classList.add('hidden');
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
