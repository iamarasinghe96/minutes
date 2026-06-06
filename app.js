/* ═══════════════════════════════════════════════════════════════
   AlburyCity Council — Meeting Minutes Tool — Frontend Logic
   ═══════════════════════════════════════════════════════════════ */

// ── Bootstrap ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Initialise 3 blank follow-up rows
  resetFollowupRows(3);

  // Load logo: try /api/logo (returns base64 for email embedding),
  // then fall back to static file paths.
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
    // Clipboard API unavailable — fall back to a prompt
    transcription = window.prompt('Clipboard access was blocked.\nPaste your transcription here:') || '';
  }

  if (!transcription.trim()) {
    showToast('Nothing found in clipboard. Copy your transcription first.', 'error');
    btn.disabled = false;
    btn.textContent = '📋 Paste & Extract with AI';
    return;
  }

  btn.textContent = 'Extracting…';
  try {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcription }),
    });
    const body = await res.json();
    if (!res.ok) { showToast(body.error || 'Extraction failed.', 'error'); return; }
    populateForm(body.data);
    showToast('Meeting minutes populated!', 'success');
  } catch {
    showToast('Could not reach server. Is it running?', 'error');
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

// ── Send via email ──────────────────────────────────────────────
async function sendEmail() {
  const data = collectFormData();
  const btn  = document.getElementById('emailBtn');
  btn.disabled = true;
  btn.textContent = 'Sending…';

  let logoHtml = '';
  try {
    const res = await fetch('/api/logo');
    if (res.ok) {
      const { dataUri } = await res.json();
      logoHtml = `
        <tr>
          <td colspan="2" style="padding:8px 12px 4px;">
            <img src="${dataUri}" height="52" style="height:52px;display:block;" alt="AlburyCity Council Logo">
          </td>
        </tr>`;
    }
  } catch { /* no logo, fine */ }

  const html    = buildEmailHTML(data, logoHtml);
  const subject = `Meeting Minutes — ${data.meeting_topic || 'AlburyCity Council'} — ${data.date || ''}`.replace(/— $/, '').trim();

  try {
    const res  = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, subject }),
    });
    const body = await res.json();
    if (!res.ok) {
      showToast(body.error || 'Failed to send email.', 'error');
    } else {
      showToast('Email sent to indika.arasinghe@alburycity.nsw.gov.au', 'success');
    }
  } catch {
    showToast('Could not reach server. Is it running?', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '✉ Send to Office Email';
  }
}

// ── Build email-compatible HTML ─────────────────────────────────
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
    <!-- Title -->
    <tr>
      <td colspan="2" bgcolor="${BLUE}"
          style="background-color:${BLUE};color:#FFFFFF;text-align:center;
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
              <th bgcolor="${BLUE}"
                  style="background-color:${BLUE};color:#FFFFFF;padding:8px 12px;
                         text-align:center;font-family:Calibri,Arial,sans-serif;
                         font-size:14px;font-weight:bold;width:34%;">Point</th>
              <th bgcolor="${BLUE}"
                  style="background-color:${BLUE};color:#FFFFFF;padding:8px 12px;
                         text-align:center;font-family:Calibri,Arial,sans-serif;
                         font-size:14px;font-weight:bold;width:33%;">Person</th>
              <th bgcolor="${BLUE}"
                  style="background-color:${BLUE};color:#FFFFFF;padding:8px 12px;
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

// ── Toast notifications ─────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent  = msg;
  toast.className    = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3400);
}
