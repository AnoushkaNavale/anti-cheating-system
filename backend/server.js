require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');
const axios   = require('axios');
const FormData = require('form-data');
const { v4: uuidv4 } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ─── In-memory store ─────────────────────────────────────────────────────────
const sessions = {};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function sha256(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

function cheatingScore(events) {
  let score = 0;
  for (const e of events) {
    if (e.eventType === 'tab_switch') score += 2;
    else if (e.eventType === 'copy')   score += 5;
    else if (e.eventType === 'paste')  score += 5;
    else if (e.eventType === 'idle')   score += 3;
    else if (e.eventType === 'right_click') score += 1;
    else if (e.eventType === 'cut')    score += 4;
  }
  return score;
}

async function uploadToPinata(jsonObject, filename) {
  const pinataApiKey    = process.env.PINATA_API_KEY;
  const pinataSecretKey = process.env.PINATA_SECRET_KEY;

  if (!pinataApiKey || pinataApiKey === 'your_pinata_api_key_here') {
    console.warn('[IPFS] No Pinata keys set – returning mock CID for demo');
    return 'QmDEMO' + crypto.randomBytes(20).toString('hex').slice(0, 38);
  }

  const form = new FormData();
  const buffer = Buffer.from(JSON.stringify(jsonObject, null, 2));
  form.append('file', buffer, {
    filename,
    contentType: 'application/json',
  });
  form.append('pinataMetadata', JSON.stringify({ name: filename }));

  const response = await axios.post(
    'https://api.pinata.cloud/pinning/pinFileToIPFS',
    form,
    {
      maxBodyLength: Infinity,
      headers: {
        ...form.getHeaders(),
        pinata_api_key:        pinataApiKey,
        pinata_secret_api_key: pinataSecretKey,
      },
    }
  );
  return response.data.IpfsHash;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', sessions: Object.keys(sessions).length });
});

// POST /start-session
app.post('/start-session', (req, res) => {
  const { studentId, examId } = req.body;
  if (!studentId || !examId) {
    return res.status(400).json({ error: 'studentId and examId are required' });
  }
  const sessionId = uuidv4();
  sessions[sessionId] = {
    studentId,
    examId,
    events:    [],
    createdAt: new Date().toISOString(),
  };
  console.log(`[Session] Started: ${sessionId} for student ${studentId}`);
  res.json({ sessionId, message: 'Session started' });
});

// POST /log-event
app.post('/log-event', (req, res) => {
  const { sessionId, studentId, examId, eventType, timestamp, metadata } = req.body;
  if (!sessionId || !eventType) {
    return res.status(400).json({ error: 'sessionId and eventType are required' });
  }
  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      studentId: studentId || 'unknown',
      examId:    examId    || 'unknown',
      events:    [],
      createdAt: new Date().toISOString(),
    };
  }
  const event = {
    id:        uuidv4(),
    studentId: studentId || sessions[sessionId].studentId,
    examId:    examId    || sessions[sessionId].examId,
    eventType,
    timestamp: timestamp || new Date().toISOString(),
    metadata:  metadata  || {},
  };
  sessions[sessionId].events.push(event);
  console.log(`[Event] ${sessionId} → ${eventType} at ${event.timestamp}`);
  res.json({ success: true, eventId: event.id, totalEvents: sessions[sessionId].events.length });
});

// GET /session-events/:sessionId
app.get('/session-events/:sessionId', (req, res) => {
  const session = sessions[req.params.sessionId];
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({
    ...session,
    eventCount: session.events.length,
    cheatScore: cheatingScore(session.events),
  });
});

// POST /finalize-log
app.post('/finalize-log', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

  const session = sessions[sessionId];
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.events.length === 0) {
    return res.status(400).json({ error: 'No events to finalize' });
  }

  try {
    const batchId     = uuidv4();
    const finalizedAt = new Date().toISOString();
    const score       = cheatingScore(session.events);

    const logBatch = {
      batchId,
      sessionId,
      studentId:   session.studentId,
      examId:      session.examId,
      createdAt:   session.createdAt,
      finalizedAt,
      eventCount:  session.events.length,
      cheatScore:  score,
      events:      session.events,
    };

    const hash = sha256(logBatch);
    logBatch.integrity = { sha256: hash, algorithm: 'sha256' };

    const filename = `exam-log-${session.studentId}-${session.examId}-${batchId}.json`;
    const cid = await uploadToPinata(logBatch, filename);

    console.log(`[Finalize] BatchId: ${batchId} | CID: ${cid} | Hash: ${hash}`);
    delete sessions[sessionId];

    res.json({
      success:    true,
      batchId,
      cid,
      sha256Hash: hash,
      studentId:  session.studentId,
      examId:     session.examId,
      eventCount: logBatch.eventCount,
      cheatScore: score,
      filename,
      ipfsUrl:    `https://gateway.pinata.cloud/ipfs/${cid}`,
    });
  } catch (err) {
    console.error('[Finalize Error]', err.message);
    res.status(500).json({ error: 'Failed to finalize log', details: err.message });
  }
});

// POST /verify
app.post('/verify', async (req, res) => {
  const { cid, originalHash } = req.body;
  if (!cid || !originalHash) {
    return res.status(400).json({ error: 'cid and originalHash are required' });
  }
  try {
    const gateways = [
      `https://gateway.pinata.cloud/ipfs/${cid}`,
      `https://ipfs.io/ipfs/${cid}`,
      `https://cloudflare-ipfs.com/ipfs/${cid}`,
    ];
    let fetchedData = null;
    for (const url of gateways) {
      try {
        const response = await axios.get(url, { timeout: 10000 });
        fetchedData = response.data;
        break;
      } catch (_) {}
    }
    if (!fetchedData) {
      return res.json({ valid: true, message: 'Demo mode: IPFS fetch skipped', demo: true });
    }
    const dataForHash    = { ...fetchedData };
    delete dataForHash.integrity;
    const recomputedHash = sha256(dataForHash);
    const valid          = recomputedHash === originalHash;
    res.json({
      valid,
      recomputedHash,
      originalHash,
      status:    valid ? 'VALID – Data is untampered' : 'TAMPERED – Hash mismatch detected!',
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Verify Error]', err.message);
    res.status(500).json({ error: 'Verification failed', details: err.message });
  }
});

// GET /all-sessions
app.get('/all-sessions', (req, res) => {
  const summary = Object.entries(sessions).map(([id, s]) => ({
    sessionId:  id,
    studentId:  s.studentId,
    examId:     s.examId,
    eventCount: s.events.length,
    cheatScore: cheatingScore(s.events),
    createdAt:  s.createdAt,
  }));
  res.json(summary);
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Exam Logger Backend running on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health\n`);
});
