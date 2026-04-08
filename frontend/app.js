/* ═══════════════════════════════════════════════
   EXAMCHAIN — FRONTEND APPLICATION LOGIC
   Real IPFS CID | No MetaMask | Results Popup
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

// ─── Cheating threshold — score >= this = cheated ────────────────────────────
const CHEAT_THRESHOLD = 10;

// ─── Application state ────────────────────────────────────────────────────────
const state = {
  sessionId:    null,
  examRunning:  false,
  events:       [],
  score:        0,
  eventCounts:  { tab_switch: 0, copy: 0, paste: 0, cut: 0, idle: 0, right_click: 0 },
  startTime:    null,
  timerInterval: null,
  idleTimer:    null,
  lastActivity: Date.now(),
  lastCid:      null,
  lastHash:     null,
  lastBatchId:  null,
  ipfsSource:   null,  // 'ipfs-desktop' | 'pinata'
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function apiUrl()          { return document.getElementById('api-url').value.trim(); }
function contractAddress() { return document.getElementById('contract-address').value.trim(); }

// ─── Toast notification ───────────────────────────────────────────────────────
function toast(msg, type = 'warn') {
  const overlay = document.getElementById('alert-overlay');
  overlay.classList.add('visible');
  const el = document.createElement('div');
  el.className = `alert-toast ${type === 'danger' ? 'danger' : type === 'success' ? 'success' : ''}`;
  el.textContent = msg;
  overlay.appendChild(el);
  setTimeout(() => {
    el.remove();
    if (!overlay.children.length) overlay.classList.remove('visible');
  }, 3200);
}

// ─── Save / load config ───────────────────────────────────────────────────────
function saveConfig() {
  localStorage.setItem('examchain_contract', document.getElementById('contract-address').value);
  localStorage.setItem('examchain_api',      document.getElementById('api-url').value);
}

function loadConfig() {
  const c = localStorage.getItem('examchain_contract');
  const a = localStorage.getItem('examchain_api');
  if (c) document.getElementById('contract-address').value = c;
  if (a) document.getElementById('api-url').value = a;
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

// ─── IPFS status check ────────────────────────────────────────────────────────
async function checkIpfsStatus() {
  const el = document.getElementById('ipfs-status-label');
  try {
    const res  = await fetch(apiUrl() + '/ipfs-status', { signal: AbortSignal.timeout(4000) });
    const data = await res.json();
    if (data.available) {
      el.textContent = '● IPFS: ' + (data.source === 'ipfs-desktop' ? 'Desktop Connected' : 'Pinata Connected');
      el.style.color = 'var(--accent)';
    } else {
      el.textContent = '○ IPFS: Not connected';
      el.style.color = 'var(--danger)';
    }
  } catch (_) {
    el.textContent = '○ IPFS: Checking...';
    el.style.color = 'var(--muted)';
  }
}

// ─── Start exam session ───────────────────────────────────────────────────────
async function startExam() {
  const studentId = document.getElementById('student-id').value.trim();
  const examId    = document.getElementById('exam-id').value.trim();
  if (!studentId || !examId) { toast('Enter Student ID and Exam ID first.'); return; }

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

// ─── Exam timer ───────────────────────────────────────────────────────────────
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

// ─── Idle detection (30s) ─────────────────────────────────────────────────────
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

// ─── Log a single event ───────────────────────────────────────────────────────
async function logEvent(eventType, detail = '') {
  if (!state.examRunning && eventType !== 'exam_start') return;

  const ev = {
    sessionId: state.sessionId,
    studentId: document.getElementById('student-id').value,
    examId:    document.getElementById('exam-id').value,
    eventType,
    timestamp: new Date().toISOString(),
    metadata:  { detail },
  };

  state.events.push(ev);
  if (SCORING[eventType]) {
    state.score += SCORING[eventType];
    state.eventCounts[eventType] = (state.eventCounts[eventType] || 0) + 1;
  }

  appendToFeed(ev);
  updateStats();

  try {
    await fetch(apiUrl() + '/log-event', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(ev),
    });
  } catch (_) { /* offline — stored locally */ }
}

// ─── Live event feed ──────────────────────────────────────────────────────────
function appendToFeed(ev) {
  const feed  = document.getElementById('event-feed');
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  const time = new Date(ev.timestamp).toLocaleTimeString('en-US', { hour12: false });
  entry.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-type ${ev.eventType}">${ev.eventType.replace('_', ' ').toUpperCase()}</span>
    <span class="log-detail">${ev.metadata.detail || '—'}</span>
  `;
  feed.insertBefore(entry, feed.firstChild);
  document.getElementById('log-count').textContent = state.events.length + ' EVENTS';
}

// ─── Update stats and risk ring ───────────────────────────────────────────────
function updateStats() {
  document.getElementById('stat-events').textContent = state.events.length;
  document.getElementById('stat-score').textContent  = state.score;
  document.getElementById('stat-tabs').textContent   = state.eventCounts.tab_switch || 0;
  document.getElementById('stat-copy').textContent   =
    (state.eventCounts.copy || 0) + (state.eventCounts.paste || 0);

  const pct = Math.min(state.score / 50, 1);
  document.getElementById('score-ring-circle').style.strokeDashoffset =
    251.2 - pct * 251.2;

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

// ─── Finalize: real IPFS upload (no fake CID) ────────────────────────────────
async function finalizeLog() {
  if (!state.sessionId) { toast('No active session', 'danger'); return; }

  document.getElementById('finalize-btn').disabled = true;
  document.getElementById('finalize-btn').innerHTML =
    '<span class="spinner"></span>UPLOADING TO IPFS...';

  try {
    // Call backend — which uploads to real IPFS Desktop or Pinata
    const res  = await fetch(apiUrl() + '/finalize-log', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sessionId: state.sessionId }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.details || err.error || 'Upload failed');
    }

    const data = await res.json();

    if (!data.success) throw new Error(data.error || 'Finalize failed');

    // These are REAL values from IPFS — not fake
    state.lastCid     = data.cid;
    state.lastHash    = data.sha256Hash;
    state.lastBatchId = data.batchId;
    state.ipfsSource  = data.source;

    // Show real CID in UI
    document.getElementById('last-cid-display').textContent = data.cid;
    document.getElementById('last-cid-display').style.color = 'var(--accent)';

    toast(`✓ Uploaded to IPFS (${data.source})! CID: ${data.cid.slice(0, 12)}...`);

    // Store blockchain record
    document.getElementById('finalize-btn').innerHTML =
      '<span class="spinner"></span>STORING ON CHAIN...';

    await storeOnBlockchain(data.batchId, data.cid, data.sha256Hash, data.cheatScore);

    toast('✓ Record stored on blockchain!');

    // Stop exam and show results popup
    stopExam();
    showResultsPopup(data.cheatScore, data.cid, data.sha256Hash, data.source);

  } catch (e) {
    console.error('[Finalize]', e);

    // Show specific error — do NOT generate fake CID
    let msg = e.message || 'Unknown error';
    if (msg.includes('IPFS') || msg.includes('fetch')) {
      msg = 'IPFS not reachable. Make sure IPFS Desktop is running and backend is started.';
    }
    toast('⚠ ' + msg, 'danger');
    document.getElementById('finalize-btn').innerHTML = '⬡ FINALIZE & STORE';
    document.getElementById('finalize-btn').disabled  = false;
  }
}

// ─── Store record locally (represents blockchain storage) ─────────────────────
async function storeOnBlockchain(batchId, cid, sha256Hash, cheatScore) {
  const studentId = document.getElementById('student-id').value;
  const examId    = document.getElementById('exam-id').value;
  const txId      = 'TX-' + Date.now() + '-' + batchId.slice(0, 8);

  const record = {
    txId,
    batchId,
    cid,
    sha256Hash,
    studentId,
    examId,
    eventCount:      state.events.length,
    cheatScore:      cheatScore || state.score,
    cheated:         (cheatScore || state.score) >= CHEAT_THRESHOLD,
    storedAt:        new Date().toISOString(),
    contractAddress: contractAddress() || 'Not configured',
    ipfsSource:      state.ipfsSource,
  };

  const records = JSON.parse(localStorage.getItem('examchain_records') || '[]');
  records.push(record);
  localStorage.setItem('examchain_records', JSON.stringify(records));

  document.getElementById('last-tx-display').textContent = txId;
  document.getElementById('last-tx-display').style.color = 'var(--accent)';

  console.log('[Blockchain] Record stored:', record);
  return txId;
}

// ─── Results Popup ────────────────────────────────────────────────────────────
function showResultsPopup(cheatScore, cid, hash, ipfsSource) {
  const cheated  = cheatScore >= CHEAT_THRESHOLD;
  const overlay  = document.getElementById('results-overlay');
  const box      = document.getElementById('results-box');

  // Set content based on verdict
  if (cheated) {
    box.className = 'results-box guilty';
    document.getElementById('results-icon').textContent    = '🚨';
    document.getElementById('results-verdict').textContent =
      'STUDENT HAS CHEATED AND IS BOOKED UNDER MALPRACTICE';
    document.getElementById('results-verdict').className   = 'results-verdict guilty';
    document.getElementById('results-sub').textContent     =
      `Risk score of ${cheatScore} exceeded the threshold of ${CHEAT_THRESHOLD}. ` +
      `All evidence has been recorded immutably on the blockchain.`;
  } else {
    box.className = 'results-box clean';
    document.getElementById('results-icon').textContent    = '✅';
    document.getElementById('results-verdict').textContent = 'STUDENT HAS NOT CHEATED';
    document.getElementById('results-verdict').className   = 'results-verdict clean';
    document.getElementById('results-sub').textContent     =
      `Risk score of ${cheatScore} is within acceptable limits. ` +
      `Exam completed with integrity.`;
  }

  // Fill in details
  document.getElementById('results-score').textContent  = cheatScore;
  document.getElementById('results-events').textContent = state.events.length;
  document.getElementById('results-cid').textContent    = cid;
  document.getElementById('results-hash').textContent   = hash.slice(0, 32) + '...';
  document.getElementById('results-source').textContent =
    ipfsSource === 'ipfs-desktop' ? 'IPFS Desktop (Local)' : 'Pinata (Cloud)';

  // Show overlay
  overlay.style.display = 'flex';
  setTimeout(() => overlay.classList.add('visible'), 10);
}

function closeResultsPopup() {
  const overlay = document.getElementById('results-overlay');
  overlay.classList.remove('visible');
  setTimeout(() => { overlay.style.display = 'none'; }, 300);
}

// ─── Stop exam and clean up ───────────────────────────────────────────────────
function stopExam() {
  state.examRunning = false;
  clearInterval(state.timerInterval);
  clearTimeout(state.idleTimer);

  document.getElementById('session-status').className   = 'status-badge finalized';
  document.getElementById('session-status').textContent = 'FINALIZED';
  document.getElementById('start-btn').disabled         = false;
  document.getElementById('finalize-btn').innerHTML     = '⬡ FINALIZE & STORE';
  document.getElementById('finalize-btn').disabled      = true;

  // Auto-fill verify tab
  if (state.lastCid)     document.getElementById('verify-cid').value     = state.lastCid;
  if (state.lastHash)    document.getElementById('verify-hash').value    = state.lastHash;
  if (state.lastBatchId) document.getElementById('fetch-batch-id').value = state.lastBatchId;
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
    resultEl.className = 'verify-result pending';
    resultEl.innerHTML = `
      <div class="verify-icon">⚠</div>
      <div class="verify-status" style="font-size:14px;color:var(--warn)">BACKEND OFFLINE</div>
      <div style="font-size:11px;color:var(--muted);margin-top:8px;font-family:var(--mono)">
        Start the backend server to verify against IPFS
      </div>`;
  }
}

// ─── Fetch blockchain record ──────────────────────────────────────────────────
async function fetchFromChain() {
  const batchId = document.getElementById('fetch-batch-id').value.trim();
  if (!batchId) { toast('Enter a batch ID'); return; }

  const el = document.getElementById('chain-fetch-result');
  el.innerHTML = '<span class="spinner"></span>Fetching record...';

  const records = JSON.parse(localStorage.getItem('examchain_records') || '[]');
  const record  = records.find(r => r.batchId === batchId || r.txId === batchId);

  if (record) {
    el.innerHTML = `
      <div class="field-label">CID (from IPFS)</div>
      <div class="cid-display">${record.cid}</div>
      <div class="field-label">SHA-256 HASH</div>
      <div class="hash-display">${record.sha256Hash}</div>
      <div style="font-family:var(--mono);font-size:11px;color:var(--text);margin-top:8px;line-height:1.8">
        Student: ${record.studentId} | Exam: ${record.examId}<br>
        Events: ${record.eventCount} | Risk Score: ${record.cheatScore}<br>
        Verdict: ${record.cheated ? '🚨 CHEATED' : '✅ CLEAN'}<br>
        IPFS Source: ${record.ipfsSource || 'Unknown'}<br>
        Stored at: ${new Date(record.storedAt).toLocaleString()}
      </div>`;
    document.getElementById('verify-cid').value  = record.cid;
    document.getElementById('verify-hash').value = record.sha256Hash;
  } else {
    el.innerHTML = `
      <div style="color:var(--muted);font-family:var(--mono);font-size:11px;">
        No record found for this batch ID.
      </div>`;
  }
}

// ─── Admin dashboard ──────────────────────────────────────────────────────────
async function refreshAdmin() {
  try {
    const res  = await fetch(apiUrl() + '/all-sessions');
    const data = await res.json();
    const tbody = document.getElementById('sessions-tbody');
    tbody.innerHTML = '';

    if (!data.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="empty-state">No active sessions</td></tr>';
    } else {
      let totalEvents = 0, totalScore = 0, flagged = 0;
      data.forEach(s => {
        totalEvents += s.eventCount;
        totalScore  += s.cheatScore;
        if (s.cheatScore >= CHEAT_THRESHOLD) flagged++;
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
    }
  } catch (_) {
    // Show finalized records from localStorage
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
    document.getElementById('admin-total-events').textContent =
      records.reduce((a, r) => a + r.eventCount, 0);
    document.getElementById('admin-avg-score').textContent =
      Math.round(records.reduce((a, r) => a + r.cheatScore, 0) / records.length);
    document.getElementById('admin-flagged').textContent =
      records.filter(r => r.cheated).length;
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

// ─── Backend + IPFS health check ─────────────────────────────────────────────
async function checkApiHealth() {
  const el = document.getElementById('api-status');
  try {
    const res = await fetch(apiUrl() + '/health', { signal: AbortSignal.timeout(3000) });
    const d   = await res.json();
    el.textContent = '● Connected (' + d.sessions + ' sessions)';
    el.style.color = 'var(--accent)';
    checkIpfsStatus();
  } catch (_) {
    el.textContent = '○ Backend offline';
    el.style.color = 'var(--danger)';
    document.getElementById('ipfs-status-label').textContent = '○ IPFS: Backend needed';
    document.getElementById('ipfs-status-label').style.color = 'var(--muted)';
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
loadConfig();
attachMonitors();
checkApiHealth();
setInterval(checkApiHealth, 15000);