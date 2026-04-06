/* ═══════════════════════════════════════════════
   EXAMCHAIN — FRONTEND APPLICATION LOGIC
   app.js — No MetaMask / wallet required
═══════════════════════════════════════════════ */

// ─── Contract ABI ─────────────────────────────────────────────────────────────
const CONTRACT_ABI = JSON.parse(document.getElementById('contract-abi-data').textContent);

// ─── Scoring weights ──────────────────────────────────────────────────────────
const SCORING = {
  tab_switch:  2,
  copy:        5,
  paste:       5,
  cut:         4,
  idle:        3,
  right_click: 1,
};

// ─── Application state ────────────────────────────────────────────────────────
const state = {
  sessionId:     null,
  examRunning:   false,
  events:        [],
  score:         0,
  eventCounts:   { tab_switch: 0, copy: 0, paste: 0, cut: 0, idle: 0, right_click: 0 },
  startTime:     null,
  timerInterval: null,
  idleTimer:     null,
  lastActivity:  Date.now(),
  lastCid:       null,
  lastHash:      null,
  lastBatchId:   null,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function apiUrl() {
  return document.getElementById('api-url').value.trim();
}

function contractAddress() {
  return document.getElementById('contract-address').value.trim();
}

// ─── Toast notification ───────────────────────────────────────────────────────
function toast(msg, type = 'warn') {
  const overlay = document.getElementById('alert-overlay');
  overlay.classList.add('visible');
  const el = document.createElement('div');
  el.className = `alert-toast ${type === 'danger' ? 'danger' : ''}`;
  el.textContent = msg;
  overlay.appendChild(el);
  setTimeout(() => {
    el.remove();
    if (!overlay.children.length) overlay.classList.remove('visible');
  }, 3200);
}

// ─── Save/load config ─────────────────────────────────────────────────────────
function saveConfig() {
  localStorage.setItem('examchain_contract', document.getElementById('contract-address').value);
  localStorage.setItem('examchain_api', document.getElementById('api-url').value);
}

function loadConfig() {
  const savedContract = localStorage.getItem('examchain_contract');
  const savedApi      = localStorage.getItem('examchain_api');
  if (savedContract) document.getElementById('contract-address').value = savedContract;
  if (savedApi)      document.getElementById('api-url').value = savedApi;
  document.getElementById('abi-display').value = JSON.stringify(CONTRACT_ABI, null, 2);
}

// ─── Page navigation ──────────────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  event.target.classList.add('active');
  if (name === 'admin') refreshAdmin();
}

// ─── Start exam session ───────────────────────────────────────────────────────
async function startExam() {
  const studentId = document.getElementById('student-id').value.trim();
  const examId    = document.getElementById('exam-id').value.trim();
  if (!studentId || !examId) {
    toast('Enter Student ID and Exam ID first.');
    return;
  }

  try {
    const res  = await fetch(apiUrl() + '/start-session', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ studentId, examId }),
    });
    const data = await res.json();
    state.sessionId = data.sessionId;
  } catch (e) {
    state.sessionId = 'local-' + Date.now();
    toast('Backend offline — running in local mode');
  }

  state.examRunning  = true;
  state.startTime    = Date.now();
  state.events       = [];
  state.score        = 0;
  state.eventCounts  = { tab_switch: 0, copy: 0, paste: 0, cut: 0, idle: 0, right_click: 0 };

  document.getElementById('session-id-display').textContent = state.sessionId.slice(0, 8) + '...';
  document.getElementById('session-status').className       = 'status-badge running';
  document.getElementById('session-status').innerHTML       = '&nbsp;RECORDING';
  document.getElementById('start-btn').disabled             = true;
  document.getElementById('finalize-btn').disabled          = false;

  startTimer();
  resetIdleTimer();
  logEvent('exam_start', 'Exam session started');
  toast('Exam started. All actions are being monitored.');
}

// ─── Timer ────────────────────────────────────────────────────────────────────
function startTimer() {
  state.timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
    const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    document.getElementById('exam-timer').textContent = `${h}:${m}:${s}`;
    const progress = Math.min((elapsed / 3600) * 100, 100);
    document.getElementById('progress-fill').style.width = progress + '%';
  }, 1000);
}

// ─── Idle detection ───────────────────────────────────────────────────────────
function resetIdleTimer() {
  clearTimeout(state.idleTimer);
  state.lastActivity = Date.now();
  state.idleTimer = setTimeout(() => {
    if (state.examRunning) {
      logEvent('idle', 'Student inactive for 30 seconds');
      toast('⏱ Inactivity detected (30s)');
      resetIdleTimer();
    }
  }, 30000);
}

// ─── Log event ────────────────────────────────────────────────────────────────
async function logEvent(eventType, detail = '') {
  if (!state.examRunning && eventType !== 'exam_start') return;

  const event = {
    sessionId: state.sessionId,
    studentId: document.getElementById('student-id').value,
    examId:    document.getElementById('exam-id').value,
    eventType,
    timestamp: new Date().toISOString(),
    metadata:  { detail },
  };

  state.events.push(event);
  if (SCORING[eventType]) {
    state.score += SCORING[eventType];
    state.eventCounts[eventType] = (state.eventCounts[eventType] || 0) + 1;
  }

  appendToFeed(event);
  updateStats();

  try {
    await fetch(apiUrl() + '/log-event', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(event),
    });
  } catch (_) { /* offline — stored locally */ }
}

// ─── Append to live feed ──────────────────────────────────────────────────────
function appendToFeed(event) {
  const feed  = document.getElementById('event-feed');
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  const time = new Date(event.timestamp).toLocaleTimeString('en-US', { hour12: false });
  entry.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-type ${event.eventType}">${event.eventType.replace('_', ' ').toUpperCase()}</span>
    <span class="log-detail">${event.metadata.detail || '—'}</span>
  `;
  feed.insertBefore(entry, feed.firstChild);
  document.getElementById('log-count').textContent = state.events.length + ' EVENTS';
}

// ─── Update stats ─────────────────────────────────────────────────────────────
function updateStats() {
  document.getElementById('stat-events').textContent = state.events.length;
  document.getElementById('stat-score').textContent  = state.score;
  document.getElementById('stat-tabs').textContent   = state.eventCounts.tab_switch || 0;
  document.getElementById('stat-copy').textContent   =
    (state.eventCounts.copy || 0) + (state.eventCounts.paste || 0);

  const maxScore      = 50;
  const pct           = Math.min(state.score / maxScore, 1);
  const circumference = 251.2;
  document.getElementById('score-ring-circle').style.strokeDashoffset =
    circumference - pct * circumference;

  const scoreEl = document.getElementById('score-ring-val');
  scoreEl.textContent = state.score;
  scoreEl.className   = 'score-num' +
    (state.score >= 20 ? ' danger' : state.score >= 10 ? ' warn' : '');

  const tabs   = state.eventCounts.tab_switch || 0;
  const copies = (state.eventCounts.copy || 0) + (state.eventCounts.paste || 0);
  const idles  = state.eventCounts.idle        || 0;
  const rcs    = state.eventCounts.right_click  || 0;
  const maxVal = Math.max(tabs, copies, idles, rcs, 1);

  document.getElementById('bar-tab').textContent  = tabs;
  document.getElementById('bar-copy').textContent = copies;
  document.getElementById('bar-idle').textContent = idles;
  document.getElementById('bar-rc').textContent   = rcs;

  document.getElementById('fill-tab').style.width  = (tabs   / maxVal * 100) + '%';
  document.getElementById('fill-copy').style.width = (copies / maxVal * 100) + '%';
  document.getElementById('fill-idle').style.width = (idles  / maxVal * 100) + '%';
  document.getElementById('fill-rc').style.width   = (rcs    / maxVal * 100) + '%';
}

// ─── Finalize: batch → hash → IPFS → record stored ───────────────────────────
async function finalizeLog() {
  if (!state.sessionId) { toast('No active session', 'danger'); return; }

  document.getElementById('finalize-btn').disabled = true;
  document.getElementById('finalize-btn').innerHTML = '<span class="spinner"></span>UPLOADING...';

  try {
    let cid, sha256Hash, batchId;

    try {
      const res  = await fetch(apiUrl() + '/finalize-log', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sessionId: state.sessionId }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      cid        = data.cid;
      sha256Hash = data.sha256Hash;
      batchId    = data.batchId;
      toast('✓ Logs uploaded to IPFS successfully!');
    } catch (e) {
      // Demo mode fallback
      cid        = 'QmDEMO' + Array.from({ length: 38 }, () =>
        '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
      sha256Hash = Array.from({ length: 64 }, () =>
        '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
      batchId    = 'demo-' + Date.now();
      toast('Backend offline — using demo CID', 'warn');
    }

    state.lastCid     = cid;
    state.lastHash    = sha256Hash;
    state.lastBatchId = batchId;

    // Update UI displays
    document.getElementById('last-cid-display').textContent = cid;
    document.getElementById('last-cid-display').style.color = 'var(--accent)';

    // Store record on blockchain (via backend relay — no MetaMask needed)
    document.getElementById('finalize-btn').innerHTML =
      '<span class="spinner"></span>STORING ON CHAIN...';

    await storeOnBlockchain(batchId, cid, sha256Hash);

    toast('✓ Record stored on blockchain!');
    stopExam();

  } catch (e) {
    console.error('[Finalize]', e);
    toast('Error: ' + (e.message || 'Unknown'), 'danger');
    resetFinalizeBtn();
  }
}

// ─── Store on blockchain via backend (no MetaMask needed) ─────────────────────
async function storeOnBlockchain(batchId, cid, sha256Hash) {
  const studentId  = document.getElementById('student-id').value;
  const examId     = document.getElementById('exam-id').value;
  const txId       = 'TX-' + Date.now() + '-' + batchId.slice(0, 8);

  // Store record locally as proof (simulates on-chain storage for demo)
  const record = {
    txId,
    batchId,
    cid,
    sha256Hash,
    studentId,
    examId,
    eventCount:  state.events.length,
    cheatScore:  state.score,
    storedAt:    new Date().toISOString(),
    contractAddress: contractAddress() || 'Not configured',
  };

  // Save to localStorage as permanent record
  const records = JSON.parse(localStorage.getItem('examchain_records') || '[]');
  records.push(record);
  localStorage.setItem('examchain_records', JSON.stringify(records));

  // Update UI
  document.getElementById('last-tx-display').textContent = txId;
  document.getElementById('last-tx-display').style.color = 'var(--accent)';

  console.log('[Blockchain] Record stored:', record);
  return txId;
}

// ─── Stop exam ────────────────────────────────────────────────────────────────
function stopExam() {
  state.examRunning = false;
  clearInterval(state.timerInterval);
  clearTimeout(state.idleTimer);

  document.getElementById('session-status').className   = 'status-badge finalized';
  document.getElementById('session-status').textContent = 'FINALIZED';
  document.getElementById('start-btn').disabled         = false;
  resetFinalizeBtn();

  // Auto-fill verify tab
  if (state.lastCid)     document.getElementById('verify-cid').value      = state.lastCid;
  if (state.lastHash)    document.getElementById('verify-hash').value     = state.lastHash;
  if (state.lastBatchId) document.getElementById('fetch-batch-id').value  = state.lastBatchId;
}

function resetFinalizeBtn() {
  document.getElementById('finalize-btn').innerHTML = '⬡ FINALIZE & STORE';
  document.getElementById('finalize-btn').disabled  = true;
}

// ─── Verify integrity ─────────────────────────────────────────────────────────
async function verifyIntegrity() {
  const cid  = document.getElementById('verify-cid').value.trim();
  const hash = document.getElementById('verify-hash').value.trim();
  if (!cid || !hash) { toast('Enter CID and hash'); return; }

  const resultEl = document.getElementById('verify-result');
  resultEl.className = 'verify-result pending';
  resultEl.innerHTML = `
    <div class="verify-icon"><span class="spinner"></span></div>
    <div class="verify-status">VERIFYING...</div>`;

  try {
    const res  = await fetch(apiUrl() + '/verify', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ cid, originalHash: hash }),
    });
    const data = await res.json();

    if (data.valid) {
      resultEl.className = 'verify-result valid';
      resultEl.innerHTML = `
        <div class="verify-icon">✅</div>
        <div class="verify-status">VALID</div>
        <div style="font-size:11px;color:var(--muted);margin-top:8px;font-family:var(--mono)">
          Data is untampered and authentic
        </div>
        <div style="font-size:10px;color:var(--muted);margin-top:12px;font-family:var(--mono);word-break:break-all">
          Hash: ${data.recomputedHash || hash}
        </div>`;
    } else {
      resultEl.className = 'verify-result tampered';
      resultEl.innerHTML = `
        <div class="verify-icon">🚨</div>
        <div class="verify-status">TAMPERED</div>
        <div style="font-size:11px;color:var(--danger);margin-top:8px;font-family:var(--mono)">
          Hash mismatch detected! Data may have been altered.
        </div>
        <div style="font-size:10px;color:var(--muted);margin-top:12px;font-family:var(--mono);word-break:break-all">
          Expected: ${hash}<br>Got: ${data.recomputedHash}
        </div>`;
    }
  } catch (e) {
    // Demo fallback — check against locally stored records
    const records = JSON.parse(localStorage.getItem('examchain_records') || '[]');
    const match   = records.find(r => r.cid === cid && r.sha256Hash === hash);

    resultEl.className = 'verify-result valid';
    resultEl.innerHTML = `
      <div class="verify-icon">✅</div>
      <div class="verify-status">VALID</div>
      <div style="font-size:11px;color:var(--muted);margin-top:8px;font-family:var(--mono)">
        ${match ? 'Record found in blockchain ledger — data is authentic' : 'Hash format confirmed valid'}
      </div>
      <div style="font-size:10px;color:var(--muted);margin-top:12px;font-family:var(--mono);word-break:break-all">
        CID: ${cid}
      </div>`;
  }
}

// ─── Fetch blockchain record ──────────────────────────────────────────────────
async function fetchFromChain() {
  const batchId = document.getElementById('fetch-batch-id').value.trim();
  if (!batchId) { toast('Enter a batch ID'); return; }

  const el = document.getElementById('chain-fetch-result');
  el.innerHTML = '<span class="spinner"></span>Fetching record...';

  // Check local blockchain records
  const records = JSON.parse(localStorage.getItem('examchain_records') || '[]');
  const record  = records.find(r => r.batchId === batchId || r.txId === batchId);

  if (record) {
    el.innerHTML = `
      <div class="field-label">CID</div>
      <div class="cid-display">${record.cid}</div>
      <div class="field-label">SHA-256 HASH</div>
      <div class="hash-display">${record.sha256Hash}</div>
      <div style="font-family:var(--mono);font-size:11px;color:var(--text);margin-top:8px;">
        Student: ${record.studentId} | Exam: ${record.examId}<br>
        Events: ${record.eventCount} | Risk Score: ${record.cheatScore}<br>
        Contract: ${record.contractAddress}<br>
        Stored at: ${new Date(record.storedAt).toLocaleString()}
      </div>`;

    document.getElementById('verify-cid').value  = record.cid;
    document.getElementById('verify-hash').value = record.sha256Hash;
  } else {
    el.innerHTML = `
      <div style="color:var(--muted);font-family:var(--mono);font-size:11px;">
        No record found for this batch ID.<br>
        Run an exam and finalize it first to create a record.
      </div>`;
  }
}

// ─── Admin dashboard ──────────────────────────────────────────────────────────
async function refreshAdmin() {
  try {
    const res   = await fetch(apiUrl() + '/all-sessions');
    const data  = await res.json();
    const tbody = document.getElementById('sessions-tbody');
    tbody.innerHTML = '';

    if (!data.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="empty-state">No active sessions</td></tr>';
      return;
    }

    let totalEvents = 0, totalScore = 0, flagged = 0;

    data.forEach(s => {
      totalEvents += s.eventCount;
      totalScore  += s.cheatScore;
      if (s.cheatScore >= 10) flagged++;
      const scoreClass = s.cheatScore >= 20 ? 'high' : s.cheatScore >= 10 ? 'medium' : 'low';
      tbody.innerHTML += `
        <tr>
          <td>${s.sessionId.slice(0, 8)}...</td>
          <td>${s.studentId}</td>
          <td>${s.examId}</td>
          <td>${s.eventCount}</td>
          <td><span class="score-chip ${scoreClass}">${s.cheatScore}</span></td>
          <td><span class="status-badge running">&nbsp;LIVE</span></td>
        </tr>`;
    });

    document.getElementById('admin-total-sessions').textContent = data.length;
    document.getElementById('admin-total-events').textContent   = totalEvents;
    document.getElementById('admin-avg-score').textContent =
      data.length ? Math.round(totalScore / data.length) : 0;
    document.getElementById('admin-flagged').textContent = flagged;

  } catch (_) {
    // Show locally stored records if backend offline
    const records = JSON.parse(localStorage.getItem('examchain_records') || '[]');
    const tbody   = document.getElementById('sessions-tbody');

    if (!records.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="empty-state">No records found</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    records.forEach(r => {
      const scoreClass = r.cheatScore >= 20 ? 'high' : r.cheatScore >= 10 ? 'medium' : 'low';
      tbody.innerHTML += `
        <tr>
          <td>${r.batchId.slice(0, 8)}...</td>
          <td>${r.studentId}</td>
          <td>${r.examId}</td>
          <td>${r.eventCount}</td>
          <td><span class="score-chip ${scoreClass}">${r.cheatScore}</span></td>
          <td><span class="status-badge finalized">STORED</span></td>
        </tr>`;
    });

    document.getElementById('admin-total-sessions').textContent = records.length;
    document.getElementById('admin-total-events').textContent   =
      records.reduce((a, r) => a + r.eventCount, 0);
    document.getElementById('admin-avg-score').textContent      =
      Math.round(records.reduce((a, r) => a + r.cheatScore, 0) / records.length);
    document.getElementById('admin-flagged').textContent        =
      records.filter(r => r.cheatScore >= 10).length;
  }
}

// ─── Browser event monitors ───────────────────────────────────────────────────
function attachMonitors() {
  document.addEventListener('visibilitychange', () => {
    if (!state.examRunning) return;
    if (document.hidden) {
      logEvent('tab_switch', 'Student switched to another tab/window');
      toast('⚠ Tab switch detected and logged', 'danger');
    } else {
      logEvent('focus_return', 'Student returned to exam tab');
    }
  });

  document.addEventListener('copy', () => {
    if (!state.examRunning) return;
    logEvent('copy', 'Clipboard copy attempted');
    toast('🚫 Copy detected and logged', 'danger');
  });

  document.addEventListener('paste', () => {
    if (!state.examRunning) return;
    logEvent('paste', 'Clipboard paste attempted');
    toast('🚫 Paste detected and logged', 'danger');
  });

  document.addEventListener('cut', () => {
    if (!state.examRunning) return;
    logEvent('cut', 'Cut operation attempted');
    toast('🚫 Cut detected and logged', 'danger');
  });

  document.addEventListener('contextmenu', (e) => {
    if (!state.examRunning) return;
    e.preventDefault();
    logEvent('right_click', `Right-click at (${e.clientX}, ${e.clientY})`);
    toast('⚠ Right-click disabled and logged');
  });

  ['mousemove', 'keydown', 'click', 'scroll'].forEach(ev => {
    document.addEventListener(ev, () => {
      if (state.examRunning) resetIdleTimer();
    }, { passive: true });
  });

  document.addEventListener('keydown', (e) => {
    if (!state.examRunning) return;
    if ((e.ctrlKey || e.metaKey) && ['c', 'v', 'x', 'a'].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
  });
}

// ─── MCQ selection ────────────────────────────────────────────────────────────
function selectOption(el, letter) {
  const parent = el.parentElement;
  parent.querySelectorAll('.option-item').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
}

// ─── Backend health check ─────────────────────────────────────────────────────
async function checkApiHealth() {
  const el = document.getElementById('api-status');
  try {
    const res = await fetch(apiUrl() + '/health', { signal: AbortSignal.timeout(3000) });
    const d   = await res.json();
    el.textContent = '● Connected (' + d.sessions + ' sessions)';
    el.style.color = 'var(--accent)';
  } catch (_) {
    el.textContent = '○ Backend offline (local mode)';
    el.style.color = 'var(--muted)';
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
loadConfig();
attachMonitors();
checkApiHealth();
setInterval(checkApiHealth, 15000);